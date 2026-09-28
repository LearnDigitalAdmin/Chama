/**
 * A small toolbar + textarea Markdown editor with a live Preview tab —
 * ported from PNS's story editor (github.com/LearnDigitalAdmin/PNS,
 * src/admin/MarkdownEditor.tsx) and restyled to MyChama's forest/gold
 * theme instead of PNS's own CSS. Same toolbar-inserts-syntax-at-cursor
 * approach: no rich-text/contentEditable library, so what's stored is
 * always plain, portable Markdown (see lib/markdown.ts for how it's
 * rendered, both here and in the exported PDF).
 *
 * Deliberately narrow — headings, quotes, lists, bold/italic, a divider.
 * This is for "Any other business" in the minutes module, not a full
 * document editor.
 */
import { useCallback, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';

export const MAX_MARKDOWN_LENGTH = 8_000;

interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}

type ToolbarAction =
  | { kind: 'wrap'; before: string; after: string }
  | { kind: 'linePrefix'; prefix: string }
  | { kind: 'insert'; text: string };

const TOOLBAR_BUTTONS: { label: string; title: string; action: ToolbarAction }[] = [
  { label: 'B', title: 'Bold', action: { kind: 'wrap', before: '**', after: '**' } },
  { label: 'I', title: 'Italic', action: { kind: 'wrap', before: '_', after: '_' } },
  { label: 'H2', title: 'Heading', action: { kind: 'linePrefix', prefix: '## ' } },
  { label: 'H3', title: 'Subheading', action: { kind: 'linePrefix', prefix: '### ' } },
  { label: '\u275D', title: 'Quote', action: { kind: 'linePrefix', prefix: '> ' } },
  { label: '\u2022', title: 'Bullet list', action: { kind: 'linePrefix', prefix: '- ' } },
  { label: '1.', title: 'Numbered list', action: { kind: 'linePrefix', prefix: '1. ' } },
  { label: '\u2015', title: 'Divider', action: { kind: 'insert', text: '\n\n---\n\n' } },
];

export function MarkdownEditor({ value, onChange, rows = 6, placeholder, disabled }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'write' | 'preview'>('write');

  const applyAction = useCallback(
    (action: ToolbarAction) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = value.slice(0, start);
      const selected = value.slice(start, end);
      const after = value.slice(end);

      let next = value;
      let cursorStart = start;
      let cursorEnd = end;

      if (action.kind === 'wrap') {
        next = before + action.before + selected + action.after + after;
        cursorStart = start + action.before.length;
        cursorEnd = cursorStart + selected.length;
      } else if (action.kind === 'linePrefix') {
        const lineStart = before.lastIndexOf('\n') + 1;
        next = value.slice(0, lineStart) + action.prefix + value.slice(lineStart);
        cursorStart = start + action.prefix.length;
        cursorEnd = end + action.prefix.length;
      } else {
        next = before + action.text + after;
        cursorStart = cursorEnd = start + action.text.length;
      }

      if (next.length > MAX_MARKDOWN_LENGTH) return;
      onChange(next);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          ta.focus();
          ta.setSelectionRange(cursorStart, cursorEnd);
        });
      });
    },
    [value, onChange]
  );

  const remaining = MAX_MARKDOWN_LENGTH - value.length;
  const nearLimit = remaining < MAX_MARKDOWN_LENGTH * 0.05;

  return (
    <div className="rounded-lg border border-forest-100 overflow-hidden">
      <div className="flex items-center justify-between gap-2 flex-wrap px-2 py-1.5 bg-forest-50 border-b border-forest-100">
        <div className="flex gap-1 flex-wrap">
          {TOOLBAR_BUTTONS.map((b) => (
            <button
              key={b.title}
              type="button"
              title={b.title}
              onClick={() => applyAction(b.action)}
              disabled={disabled || mode === 'preview'}
              className="min-w-[26px] h-[26px] px-1 rounded-md text-xs font-semibold text-forest-700 hover:bg-forest-100 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setMode('write')}
            className={`text-xs font-semibold px-2 py-1 rounded-md ${mode === 'write' ? 'bg-forest-700 text-white' : 'text-forest-700'}`}
          >
            Write
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={`text-xs font-semibold px-2 py-1 rounded-md ${mode === 'preview' ? 'bg-forest-700 text-white' : 'text-forest-700'}`}
          >
            Preview
          </button>
        </div>
      </div>

      {mode === 'write' ? (
        <textarea
          ref={textareaRef}
          rows={rows}
          placeholder={placeholder}
          value={value}
          maxLength={MAX_MARKDOWN_LENGTH}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm outline-none resize-y disabled:bg-forest-50/50"
        />
      ) : (
        <div
          className="md-preview px-3 py-2 text-sm min-h-[80px] max-h-[280px] overflow-y-auto"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(value) || '<p class="opacity-50">Nothing to preview yet…</p>',
          }}
        />
      )}

      <div className="flex justify-between px-3 py-1 bg-forest-50/50 border-t border-forest-100">
        <span className="text-[11px] text-forest-900/50">Headings, quotes, lists, bold/italic — use the toolbar.</span>
        <span className={`text-[11px] ${nearLimit ? 'text-brick-500' : 'text-forest-900/50'}`}>
          {value.length.toLocaleString()} / {MAX_MARKDOWN_LENGTH.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export default MarkdownEditor;
