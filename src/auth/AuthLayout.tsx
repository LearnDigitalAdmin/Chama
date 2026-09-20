import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <header className="h-16 flex items-center px-5 border-b border-forest-100 bg-paper/90 backdrop-blur">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-forest-700 flex items-center justify-center text-gold-300 font-display font-bold">M</div>
          <span className="font-display font-semibold text-lg tracking-tight text-ink">MyChama</span>
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm card shadow-card p-7">
          <h1 className="font-display text-xl font-semibold text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-forest-900/60 mt-1">{subtitle}</p>}
          <div className="mt-6 flex flex-col gap-4">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function FormField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
      {label}
      {children}
    </label>
  );
}

export const inputClass =
  'w-full px-3.5 py-2.5 rounded-lg border border-forest-100 text-[15px] focus:border-forest-700';

export function PrimaryButton({ className = '', children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`btn-primary font-semibold px-4 py-2.5 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({ className = '', children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`text-sm font-semibold text-forest-700 hover:text-forest-800 text-center ${className}`}>
      {children}
    </button>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="text-sm text-brick-500 font-medium">{children}</p>;
}
