import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import BrandMark from '../brand/BrandMark';
import { INSTALL_BENEFITS } from '../marketing/content';
import { usePWA } from './usePWA';
import { installSteps } from './installSteps';

/** Where the banner may appear: landing, sign-in chooser, and inside the app. Never over OTP / forms. */
function bannerAllowed(path: string) {
  return path === '/' || path === '/signin' || path.startsWith('/app');
}

function InstallBanner() {
  const { installed, canPrompt, canInstallHere, requestInstall, openSheet, dismissBanner, isBannerSnoozed } = usePWA();
  const { pathname } = useLocation();
  const [ready, setReady] = useState(false);
  const inApp = pathname.startsWith('/app');

  // Give the page a moment to settle before asking for anything.
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 2500);
    return () => window.clearTimeout(t);
  }, []);

  if (!ready || installed || !canInstallHere || !bannerAllowed(pathname) || isBannerSnoozed()) return null;

  return (
    <div
      role="dialog"
      aria-label="Install MyChama"
      className={`toast-in fixed z-50 inset-x-3 md:inset-x-auto md:right-6 md:w-96 card shadow-2xl p-4 ${
        inApp ? 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-6' : 'bottom-[calc(1rem+env(safe-area-inset-bottom))]'
      }`}
    >
      <div className="flex items-start gap-3">
        <BrandMark size={44} />
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-ink">Install MyChama on your device</p>
          <ul className="mt-1 space-y-0.5 text-xs text-forest-900/65">
            {INSTALL_BENEFITS.map((b) => (
              <li key={b} className="flex gap-1.5"><span className="text-forest-500">✓</span>{b}</li>
            ))}
          </ul>
        </div>
        <button onClick={dismissBanner} aria-label="Dismiss" className="-mt-1 -mr-1 w-8 h-8 rounded-full hover:bg-forest-50 text-forest-900/50">✕</button>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => (canPrompt ? void requestInstall() : openSheet())}
          className="btn-primary flex-1 font-semibold text-sm py-2.5 rounded-full"
        >
          {canPrompt ? 'Install app' : 'How to install'}
        </button>
        <button onClick={dismissBanner} className="text-sm font-semibold text-forest-900/60 px-4 rounded-full hover:bg-forest-50">Not now</button>
      </div>
    </div>
  );
}

function InstallSheet() {
  const { sheetOpen, closeSheet, platform, browser, inAppBrowser } = usePWA();
  if (!sheetOpen) return null;
  const { title, steps, note } = installSteps({ platform, browser, inAppBrowser });
  return (
    <div className="fixed inset-0 z-[60] bg-ink/40 flex items-end md:items-center justify-center" onClick={closeSheet}>
      <div role="dialog" aria-modal="true" aria-label={title} className="toast-in w-full md:max-w-md bg-white rounded-t-2xl md:rounded-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <BrandMark size={44} />
          <h2 className="font-display font-semibold text-lg text-ink flex-1">{title}</h2>
          <button onClick={closeSheet} aria-label="Close" className="w-8 h-8 rounded-full hover:bg-forest-50 text-forest-900/50">✕</button>
        </div>
        <ol className="mt-4 space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-forest-900/80">
              <span className="w-6 h-6 shrink-0 rounded-full bg-forest-50 text-forest-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        {note && <p className="mt-4 text-xs text-forest-900/50">{note}</p>}
        <button onClick={closeSheet} className="btn-primary w-full mt-5 font-semibold text-sm py-2.5 rounded-full">Got it</button>
      </div>
    </div>
  );
}

function UpdateToast() {
  const { updateReady, applyUpdate } = usePWA();
  if (!updateReady) return null;
  return (
    <div role="status" className="toast-in fixed z-50 left-1/2 -translate-x-1/2 top-[calc(0.75rem+env(safe-area-inset-top))] bg-ink text-white rounded-full pl-4 pr-1.5 py-1.5 flex items-center gap-3 shadow-2xl text-sm max-w-[calc(100vw-1.5rem)]">
      <span>A new version of MyChama is ready.</span>
      <button onClick={applyUpdate} className="bg-gold-400 hover:bg-gold-500 text-ink font-semibold rounded-full px-4 py-1.5">Update</button>
    </div>
  );
}

/** Mount once, inside the Router. */
export default function PWAPrompts() {
  return (
    <>
      <InstallBanner />
      <InstallSheet />
      <UpdateToast />
    </>
  );
}
