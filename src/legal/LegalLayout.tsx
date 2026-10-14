import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import BrandMark from '../brand/BrandMark';
import { LEGAL, LEGAL_PATHS, formatEffectiveDate } from './legalConfig';

export interface LegalSection { id: string; title: string; body: ReactNode }

/* ---------- tiny content primitives so the two documents read the same ---------- */

export const P = ({ children }: { children: ReactNode }) => <p className="text-[15px] leading-relaxed text-ink/80 mt-3">{children}</p>;

export const UL = ({ children }: { children: ReactNode }) => (
  <ul className="list-disc pl-5 mt-3 space-y-1.5 text-[15px] leading-relaxed text-ink/80 marker:text-forest-400">{children}</ul>
);

export const H3 = ({ children }: { children: ReactNode }) => <h3 className="font-display font-semibold text-base text-ink mt-6">{children}</h3>;

export function Callout({ title, children, tone = 'plain' }: { title?: string; children: ReactNode; tone?: 'plain' | 'important' }) {
  const cls = tone === 'important' ? 'bg-gold-50 border-gold-200' : 'bg-forest-50 border-forest-100';
  return (
    <div className={`mt-4 rounded-xl border px-4 py-3 text-[15px] leading-relaxed text-ink/85 ${cls}`}>
      {title && <p className="font-display font-semibold text-ink mb-1">{title}</p>}
      {children}
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-forest-100 bg-white">
      <table className="w-full text-sm text-left">
        <thead className="bg-forest-50 text-forest-800">
          <tr>{head.map((h) => <th key={h} className="px-3 py-2 font-semibold align-bottom">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-forest-100 align-top">
              {r.map((c, j) => <td key={j} className="px-3 py-2 text-ink/80">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Mail = () => <a href={`mailto:${LEGAL.email}`} className="text-forest-700 underline underline-offset-2">{LEGAL.email}</a>;
export const TermsLink = () => <Link to={LEGAL_PATHS.terms} className="text-forest-700 underline underline-offset-2">Terms &amp; Conditions</Link>;
export const PrivacyLink = () => <Link to={LEGAL_PATHS.privacy} className="text-forest-700 underline underline-offset-2">Privacy Policy</Link>;

/* ---------- page shell ---------- */

export default function LegalLayout({
  title, intro, sections, other,
}: {
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
  other: { to: string; label: string };
}) {
  // Honour #section links on first load (the router doesn't scroll to hashes by itself).
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [title]);

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="h-16 flex items-center px-5 border-b border-forest-100 bg-paper/90 backdrop-blur sticky top-0 z-20">
        <Link to="/" className="flex items-center gap-2">
          <BrandMark size={32} />
          <span className="font-display font-semibold text-lg tracking-tight">MyChama</span>
        </Link>
        <nav aria-label="Legal" className="ml-auto flex gap-4 text-sm font-semibold">
          <Link to={LEGAL_PATHS.terms} className="text-forest-700 hover:text-forest-800">Terms</Link>
          <Link to={LEGAL_PATHS.privacy} className="text-forest-700 hover:text-forest-800">Privacy</Link>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-10 lg:grid lg:grid-cols-[15rem_1fr] lg:gap-12">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-2 text-sm">
            <p className="font-display font-semibold text-ink mb-2">On this page</p>
            <ol className="space-y-1.5">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-forest-900/65 hover:text-forest-700 leading-snug block">
                    <span className="num text-forest-400 mr-1.5">{i + 1}.</span>{s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="min-w-0 max-w-3xl">
          <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-forest-900/55 mt-2">
            Version {LEGAL.version} · Effective {formatEffectiveDate()} · {LEGAL.company}, {LEGAL.place}
          </p>
          {intro}

          <details className="lg:hidden mt-6 card px-4 py-3">
            <summary className="font-display font-semibold cursor-pointer">Jump to a section</summary>
            <ol className="mt-3 space-y-2 text-sm">
              {sections.map((s, i) => (
                <li key={s.id}><a href={`#${s.id}`} className="text-forest-700">{i + 1}. {s.title}</a></li>
              ))}
            </ol>
          </details>

          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 mt-10 pt-8 border-t border-forest-100 first-of-type:border-t-0">
              <h2 className="font-display text-xl font-semibold">
                <a href={`#${s.id}`} className="no-underline text-ink"><span className="num text-forest-400 mr-2">{i + 1}.</span>{s.title}</a>
              </h2>
              {s.body}
            </section>
          ))}

          <div className="mt-12 pt-6 border-t border-forest-100 text-sm text-forest-900/60 flex flex-wrap items-center justify-between gap-3">
            <span>Questions? <Mail /></span>
            <Link to={other.to} className="font-semibold text-forest-700 hover:text-forest-800">{other.label} →</Link>
          </div>
        </article>
      </main>

      <footer className="border-t border-forest-100 py-8">
        <div className="max-w-6xl mx-auto px-5 text-xs text-forest-900/50 flex flex-wrap items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} {LEGAL.company}</span>
          <nav aria-label="Footer" className="flex gap-4">
            <Link to="/" className="hover:text-forest-700">Home</Link>
            <Link to={LEGAL_PATHS.terms} className="hover:text-forest-700">Terms</Link>
            <Link to={LEGAL_PATHS.privacy} className="hover:text-forest-700">Privacy</Link>
          </nav>
          <span>By Samuhia</span>
        </div>
      </footer>
    </div>
  );
}
