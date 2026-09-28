/**
 * Renders a chama's meeting minutes into a branded, multi-page PDF —
 * entirely in the browser, with jsPDF + jspdf-autotable. No network call,
 * no Cloud Function, no Storage upload: this replaces the old
 * generateStatement({ minutesId, format: 'pdf' }) round trip (which could
 * not work at all offline) with something that works the instant it's
 * clicked, connected or not. See functions/mychama/billing.py — the old
 * `_render_minutes_pdf` (plain ReportLab, no branding) is gone; the only
 * server-side piece left is `recordMinutesExport`, which just logs the
 * export against the plan's quota (queued automatically if offline, via
 * callables.ts' `callable()` — it never blocks the download below).
 *
 * The "Any other business" field supports a small set of Markdown block
 * types (##/### headings, > quotes, - / 1. lists, bold/italic, ---
 * dividers) authored via components/MarkdownEditor.tsx. We walk `marked`'s
 * token tree ourselves (rather than jsPDF's flaky html() plugin) so we get
 * full control over word-wrapping and page breaks. Agenda and resolution
 * lines stay plain one-per-line lists (unchanged data shape — string[] —
 * so old minutes keep rendering correctly) but each line still gets
 * inline bold/italic support, run through the same tokenizer.
 *
 * Brand fonts (Space Grotesk / Inter) aren't embedded — that would add a
 * meaningful chunk of bundle size for a document nobody reads on-brand-font
 * grounds. Helvetica (jsPDF's built-in default) in the app's actual colour
 * palette reads just as clean and professional.
 */

import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import { fmtDate } from './dates';

export interface MinutesPdfInput {
  chamaName: string;
  title: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  venue?: string | null;
  chairPresent?: boolean;
  recordedByName: string;
  /** Names of members ticked present, in roster order. */
  presentNames: string[];
  /** Names of active roster members NOT ticked present. */
  absentNames: string[];
  agenda: string[];
  resolutions: string[];
  /** Markdown — headings, quotes, lists, bold/italic, dividers. */
  aob?: string | null;
  /** ISO date (YYYY-MM-DD). */
  nextMeeting?: string | null;
}

// -- Brand palette (1:1 with src/index.css's @theme tokens) — RGB tuples,
// since that's the one Color form every jsPDF/autotable colour API accepts
// without ambiguity. ------------------------------------------------------
const FOREST_900: [number, number, number] = [18, 43, 32];
const FOREST_700: [number, number, number] = [31, 77, 58];
const FOREST_100: [number, number, number] = [216, 232, 220];
const FOREST_50: [number, number, number] = [238, 245, 240];
const GOLD_300: [number, number, number] = [237, 190, 92];
const GOLD_400: [number, number, number] = [232, 163, 61];
const GOLD_600: [number, number, number] = [181, 109, 22];
const INK: [number, number, number] = [18, 33, 28];
const INK_FADED: [number, number, number] = [110, 122, 116];
const WHITE: [number, number, number] = [255, 255, 255];

const MARGIN = 42;
const PAGE1_CONTENT_TOP = 132;
const CONT_CONTENT_TOP = 58;
const FOOTER_ZONE = 34;

type Style = { bold?: boolean; italic?: boolean };
type Run = { text: string } & Style;

/** Flattens marked's nested inline token tree into a flat run list carrying
 *  only the bold/italic styling we render (links/code/etc. fall back to
 *  plain text — minutes don't need clickable links). */
function flattenInline(tokens: Token[] | undefined, style: Style = {}): Run[] {
  const runs: Run[] = [];
  for (const t of tokens ?? []) {
    if (t.type === 'strong') {
      runs.push(...flattenInline((t as Tokens.Strong).tokens, { ...style, bold: true }));
    } else if (t.type === 'em') {
      runs.push(...flattenInline((t as Tokens.Em).tokens, { ...style, italic: true }));
    } else if ('tokens' in t && t.tokens) {
      runs.push(...flattenInline(t.tokens as Token[], style));
    } else if ('text' in t && typeof t.text === 'string') {
      runs.push({ text: t.text, ...style });
    }
  }
  return runs;
}

/** Parses one line of plain text for inline bold/italic markup only —
 *  used for agenda/resolution lines, which stay one-per-line strings. */
function inlineRunsForLine(line: string): Run[] {
  const tokens = marked.lexer(line);
  const first = tokens[0];
  if (first && first.type === 'paragraph') {
    return flattenInline((first as Tokens.Paragraph).tokens);
  }
  return [{ text: line }];
}

function fontStyleFor(s: Style): 'normal' | 'bold' | 'italic' | 'bolditalic' {
  if (s.bold && s.italic) return 'bolditalic';
  if (s.bold) return 'bold';
  if (s.italic) return 'italic';
  return 'normal';
}

/** Everything the block/inline renderers need, bundled so page-break
 *  handling (which must insert a fresh page starting at CONT_CONTENT_TOP)
 *  lives in one place. */
interface Layout {
  doc: jsPDF;
  pageW: number;
  pageH: number;
  bottomLimit: number;
}

function ensureRoom(l: Layout, y: number): number {
  if (y > l.bottomLimit) {
    l.doc.addPage();
    return CONT_CONTENT_TOP;
  }
  return y;
}

/** Draws word-wrapped, mixed bold/italic runs starting at (x, y), returning
 *  the y position of the next free line. Wraps on word boundaries and
 *  inserts new pages via `ensureRoom` mid-paragraph if needed. */
function drawRuns(l: Layout, runs: Run[], x: number, y: number, maxWidth: number, size: number): number {
  const { doc } = l;
  doc.setFontSize(size);
  const lineHeight = size * 1.4;
  let cursorX = x;
  let cursorY = ensureRoom(l, y);
  for (const run of runs) {
    const chunks = run.text.split(/(\s+)/).filter((c) => c !== '');
    for (const chunk of chunks) {
      doc.setFont('helvetica', fontStyleFor(run));
      const isSpace = chunk.trim() === '';
      const w = doc.getTextWidth(chunk);
      if (!isSpace && cursorX + w > x + maxWidth) {
        cursorX = x;
        cursorY += lineHeight;
        cursorY = ensureRoom(l, cursorY);
      }
      if (!isSpace) doc.text(chunk, cursorX, cursorY);
      cursorX += w;
    }
  }
  return cursorY + lineHeight;
}

function sectionHeading(l: Layout, label: string, x: number, y: number, width: number): number {
  const { doc } = l;
  let cursorY = ensureRoom(l, y + 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...GOLD_600);
  doc.text(label.toUpperCase(), x, cursorY);
  doc.setDrawColor(...FOREST_100);
  doc.setLineWidth(0.75);
  doc.line(x, cursorY + 4, x + width, cursorY + 4);
  return cursorY + 16;
}

/** Renders one Markdown block-token tree (headings, quotes, lists, hr,
 *  paragraphs) — used for the "Any other business" field. */
function renderBlocks(l: Layout, tokens: Token[], x: number, y: number, maxWidth: number): number {
  const { doc } = l;
  let cursorY = y;
  for (const token of tokens) {
    cursorY = ensureRoom(l, cursorY);
    switch (token.type) {
      case 'heading': {
        const h = token as Tokens.Heading;
        cursorY += 5;
        doc.setTextColor(...FOREST_900);
        cursorY = drawRuns(l, flattenInline(h.tokens, { bold: true }), x, cursorY, maxWidth, h.depth <= 2 ? 12 : 10.5);
        break;
      }
      case 'paragraph': {
        doc.setTextColor(...INK);
        cursorY = drawRuns(l, flattenInline((token as Tokens.Paragraph).tokens), x, cursorY, maxWidth, 10);
        break;
      }
      case 'blockquote': {
        const startY = cursorY - 9;
        doc.setTextColor(...INK_FADED);
        cursorY = renderBlocks(l, (token as Tokens.Blockquote).tokens, x + 14, cursorY, maxWidth - 14);
        doc.setDrawColor(...GOLD_400);
        doc.setLineWidth(2);
        doc.line(x, startY, x, Math.max(startY + 10, cursorY - 8));
        break;
      }
      case 'list': {
        const list = token as Tokens.List;
        let n = typeof list.start === 'number' ? list.start : 1;
        for (const item of list.items) {
          cursorY = ensureRoom(l, cursorY);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(...GOLD_600);
          doc.text(list.ordered ? `${n}.` : '\u2022', x, cursorY);
          const first = item.tokens[0] as { tokens?: Token[] } | undefined;
          const inner = first?.tokens ?? item.tokens;
          doc.setTextColor(...INK);
          cursorY = drawRuns(l, flattenInline(inner), x + 14, cursorY, maxWidth - 14, 10);
          n++;
        }
        break;
      }
      case 'hr': {
        cursorY += 4;
        doc.setDrawColor(...FOREST_100);
        doc.setLineWidth(0.75);
        doc.line(x, cursorY, x + maxWidth, cursorY);
        cursorY += 12;
        break;
      }
      case 'space':
        cursorY += 5;
        break;
      default:
        break;
    }
  }
  return cursorY;
}

function bulletedLines(l: Layout, lines: string[], x: number, y: number, maxWidth: number): number {
  const { doc } = l;
  let cursorY = y;
  for (const line of lines) {
    cursorY = ensureRoom(l, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...GOLD_600);
    doc.text('\u2022', x, cursorY);
    doc.setTextColor(...INK);
    cursorY = drawRuns(l, inlineRunsForLine(line), x + 12, cursorY, maxWidth - 12, 10);
  }
  return cursorY;
}

export function downloadMinutesPdf(input: MinutesPdfInput): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  const l: Layout = { doc, pageW, pageH, bottomLimit: pageH - FOOTER_ZONE - 14 };

  // -- Page 1 header band ---------------------------------------------
  doc.setFillColor(...FOREST_700);
  doc.rect(0, 0, pageW, PAGE1_CONTENT_TOP - 28, 'F');

  doc.setFillColor(...FOREST_900);
  doc.roundedRect(MARGIN, 20, 20, 20, 4, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...GOLD_300);
  doc.text('M', MARGIN + 10, 34, { align: 'center' });
  doc.setFontSize(10.5);
  doc.setTextColor(...WHITE);
  doc.text('MyChama · Meeting Minutes', MARGIN + 28, 34);

  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...WHITE);
  doc.text(input.chamaName, MARGIN, 62);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(input.title, MARGIN, 80);

  const metaBits = [fmtDate(input.date)];
  if (input.venue) metaBits.push(input.venue);
  metaBits.push(input.chairPresent === false ? 'Chair absent' : 'Chair present');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(230, 236, 232);
  doc.text(metaBits.join('   ·   '), MARGIN, 96);

  // -- Attendance -------------------------------------------------------
  let y = sectionHeading(l, 'Attendance', MARGIN, PAGE1_CONTENT_TOP, contentW);
  const total = input.presentNames.length + input.absentNames.length;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...INK_FADED);
  doc.text(`${input.presentNames.length} of ${total} member${total === 1 ? '' : 's'} present`, MARGIN, y);
  y += 10;

  const rows: [string, string][] = [
    ...input.presentNames.map((n): [string, string] => [n, 'Present']),
    ...input.absentNames.map((n): [string, string] => [n, 'Absent']),
  ];
  if (rows.length === 0) rows.push(['—', 'No roster on file']);

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Member', 'Status']],
    body: rows,
    theme: 'plain',
    styles: { fontSize: 9.5, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 }, textColor: INK },
    headStyles: { fillColor: FOREST_700, textColor: WHITE, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: FOREST_50 },
    columnStyles: { 1: { cellWidth: 90 } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        data.cell.styles.textColor = data.cell.raw === 'Present' ? FOREST_700 : [150, 150, 150];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40) + 18;

  // -- Agenda / Resolutions / AOB / Next meeting ------------------------
  if (input.agenda.length > 0) {
    y = sectionHeading(l, 'Agenda', MARGIN, y, contentW);
    y = bulletedLines(l, input.agenda, MARGIN, y, contentW);
    y += 8;
  }
  if (input.resolutions.length > 0) {
    y = sectionHeading(l, 'Resolutions', MARGIN, y, contentW);
    y = bulletedLines(l, input.resolutions, MARGIN, y, contentW);
    y += 8;
  }
  if (input.aob && input.aob.trim()) {
    y = sectionHeading(l, 'Any other business', MARGIN, y, contentW);
    y = renderBlocks(l, marked.lexer(input.aob), MARGIN, y, contentW);
    y += 8;
  }
  if (input.nextMeeting) {
    y = ensureRoom(l, y + 10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...FOREST_900);
    doc.text(`Next meeting: ${fmtDate(input.nextMeeting)}`, MARGIN, y);
    y += 18;
  }

  y = ensureRoom(l, y + 12);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(...INK_FADED);
  doc.text(`Recorded by ${input.recordedByName} · generated ${fmtDate(new Date().toISOString().slice(0, 10))}`, MARGIN, y);

  // -- Second pass: watermark, continuation-page strip, footer on every
  // page, regardless of whether it came from autoTable's own pagination
  // or a page we added ourselves inside ensureRoom(). ------------------
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    doc.saveGraphicsState();
    doc.setGState(doc.GState({ opacity: 0.05 }));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(64);
    doc.setTextColor(...FOREST_700);
    doc.text('MYCHAMA', pageW / 2, pageH / 2, { align: 'center', angle: 35 });
    doc.restoreGraphicsState();

    if (p > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...FOREST_700);
      doc.text(input.chamaName, MARGIN, 28);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...INK_FADED);
      doc.text(`Minutes — ${input.title}`, pageW - MARGIN, 28, { align: 'right' });
      doc.setDrawColor(...FOREST_100);
      doc.setLineWidth(0.75);
      doc.line(MARGIN, 36, pageW - MARGIN, 36);
    }

    doc.setDrawColor(...FOREST_100);
    doc.setLineWidth(0.75);
    doc.line(MARGIN, pageH - FOOTER_ZONE, pageW - MARGIN, pageH - FOOTER_ZONE);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...INK_FADED);
    doc.text('chama.samuhia.co.ke', MARGIN, pageH - FOOTER_ZONE + 14);
    doc.text(`Page ${p} of ${totalPages}`, pageW - MARGIN, pageH - FOOTER_ZONE + 14, { align: 'right' });
  }

  const slug = input.chamaName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  doc.save(`minutes-${slug}-${input.date}.pdf`);
}
