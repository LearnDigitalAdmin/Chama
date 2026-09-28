/**
 * Converts editor-authored Markdown into sanitized HTML, safe to render via
 * dangerouslySetInnerHTML. Same approach as PNS's src/lib/markdown.ts (see
 * github.com/LearnDigitalAdmin/PNS) — kept intentionally small: this is for
 * a "headings, quotes, bold, lists" minutes field, not a full document
 * editor, so the allow-list below is deliberately narrow.
 *
 * This only feeds the in-app live preview. The PDF export (lib/minutesPdf.ts)
 * does NOT go through HTML — it walks marked's token tree directly for full
 * control over pagination, so the two stay in sync by construction (same
 * `marked` parse, two different renderers) rather than by convention.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  breaks: true, // a single newline becomes <br>, matching how people expect plain typing to behave
  gfm: true,
});

export function renderMarkdown(md: string | undefined | null): string {
  if (!md) return '';
  const rawHtml = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'hr'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  });
}
