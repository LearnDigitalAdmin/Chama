import { usePWA } from './usePWA';

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />
  </svg>
);

/**
 * Persistent "Install app" pill. Renders nothing once installed or when the browser
 * offers no way to install, so it is safe to drop into any header.
 * `compact` = icon-only on phones, icon + label from `sm` up.
 */
export default function InstallButton({ className = '', tone = 'light' }: { className?: string; tone?: 'light' | 'solid' }) {
  const { installed, canInstallHere, requestInstall } = usePWA();
  if (installed || !canInstallHere) return null;
  const look = tone === 'solid' ? 'bg-gold-400 hover:bg-gold-500 text-ink' : 'border border-forest-200 text-forest-800 hover:bg-forest-50';
  return (
    <button
      type="button"
      onClick={() => void requestInstall()}
      aria-label="Install the MyChama app"
      className={`inline-flex items-center gap-1.5 rounded-full text-sm font-semibold h-9 px-2.5 sm:px-3.5 transition-colors ${look} ${className}`}
    >
      <DownloadIcon />
      <span className="hidden sm:inline">Install app</span>
    </button>
  );
}
