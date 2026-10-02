/**
 * pwaManager — the one place that knows about installability, the service worker
 * and update state. React reads it through usePWA() (useSyncExternalStore).
 *
 * Design rules (each one exists because of a real failure mode):
 *  1. init() runs from main.tsx BEFORE React renders. `beforeinstallprompt` can fire
 *     before any component mounts; if nobody is listening yet the prompt is lost.
 *  2. The SW is registered in production builds only. In dev a cache-first SW makes
 *     hot reload maddening.
 *  3. A new SW never takes over silently. MyChama is a data-entry app with an offline
 *     queue; reloading under a treasurer mid-entry is worse than being a version behind.
 *     The UI shows "Update available" and only the user's tap triggers skipWaiting + reload.
 *  4. iOS Safari has NO install event. We detect it and show manual "Add to Home Screen"
 *     steps instead of silently doing nothing.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';
export type InstallPlatform = 'ios' | 'android' | 'desktop';
export type InstallBrowser = 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'other';

export interface PWASnapshot {
  /** Running as an installed app (standalone window / home-screen launch). */
  installed: boolean;
  /** The browser handed us a native install prompt we can trigger. */
  canPrompt: boolean;
  /** No native prompt exists here (iOS, Safari, Firefox) but manual install steps do. */
  manualInstall: boolean;
  /** Opened inside Instagram/Facebook/WhatsApp etc. — can't install from here. */
  inAppBrowser: boolean;
  platform: InstallPlatform;
  browser: InstallBrowser;
  /** A newer service worker is installed and waiting for the user's OK. */
  updateReady: boolean;
  /** The "how to install" sheet is open. */
  sheetOpen: boolean;
}

const DISMISS_KEY = 'mychama.pwa.installDismissed';
const INSTALLED_KEY = 'mychama.pwa.installed';

type Listener = () => void;

// ───────────────────────── environment detection ─────────────────────────

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

function detectPlatform(): InstallPlatform {
  const u = ua();
  const iPadOS = typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(u) || iPadOS) return 'ios';
  if (/Android/i.test(u)) return 'android';
  return 'desktop';
}

function detectBrowser(): InstallBrowser {
  const u = ua();
  if (/SamsungBrowser/i.test(u)) return 'samsung';
  if (/EdgA?|EdgiOS|Edg\//i.test(u)) return 'edge';
  if (/FxiOS|Firefox/i.test(u)) return 'firefox';
  if (/CriOS|Chrome\//i.test(u)) return 'chrome';
  if (/Safari/i.test(u)) return 'safari';
  return 'other';
}

function detectInAppBrowser(): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|Twitter|LinkedInApp|; wv\)/i.test(ua());
}

function readInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = (q: string) => window.matchMedia?.(q).matches;
  return (
    mm('(display-mode: standalone)') ||
    mm('(display-mode: fullscreen)') ||
    mm('(display-mode: minimal-ui)') ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    document.referrer.startsWith('android-app://')
  );
}

// ───────────────────────────── store ─────────────────────────────

class PWAManager {
  private deferred: BeforeInstallPromptEvent | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private listeners = new Set<Listener>();
  private userRequestedUpdate = false;
  private started = false;
  private state: PWASnapshot = this.compute({ updateReady: false, sheetOpen: false });

  // ── external-store contract ──
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  getSnapshot = () => this.state;

  private compute(patch: Partial<Pick<PWASnapshot, 'updateReady' | 'sheetOpen'>>): PWASnapshot {
    const platform = detectPlatform();
    const browser = detectBrowser();
    const installed = readInstalled();
    const canPrompt = this.deferred !== null;
    const inAppBrowser = detectInAppBrowser();
    // Safari (iOS + macOS 17+) and Android Firefox never fire beforeinstallprompt but do offer install by menu.
    // Desktop Firefox can't install web apps at all, so it gets no install UI.
    const manualInstall =
      !installed && !canPrompt && !inAppBrowser &&
      (platform === 'ios' || browser === 'safari' || (browser === 'firefox' && platform === 'android'));
    return {
      installed,
      canPrompt,
      manualInstall,
      inAppBrowser,
      platform,
      browser,
      updateReady: patch.updateReady ?? this.state?.updateReady ?? false,
      sheetOpen: patch.sheetOpen ?? this.state?.sheetOpen ?? false,
    };
  }

  private emit(patch: Partial<Pick<PWASnapshot, 'updateReady' | 'sheetOpen'>> = {}) {
    this.state = this.compute(patch);
    this.listeners.forEach((l) => l());
  }

  /** Does the current environment give the user ANY way to install? Drives button/banner visibility. */
  canInstallHere = (s: PWASnapshot = this.state) => !s.installed && (s.canPrompt || s.manualInstall || (s.inAppBrowser && s.platform !== 'desktop'));

  // ── lifecycle ──
  /** Call once, before React renders. Idempotent. */
  init() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // stop Chrome's mini-infobar; we show our own UI
      this.deferred = e as BeforeInstallPromptEvent;
      this.emit();
    });

    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      safeSet(INSTALLED_KEY, '1');
      safeRemove(DISMISS_KEY);
      this.emit({ sheetOpen: false });
    });

    // Install can complete in another tab / from the browser menu.
    window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => this.emit());

    if (import.meta.env.PROD) void this.registerServiceWorker();
  }

  private async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      this.registration = reg;

      // An update finished installing on a previous visit and is waiting.
      if (reg.waiting && navigator.serviceWorker.controller) this.emit({ updateReady: true });

      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) this.emit({ updateReady: true });
        });
      });

      // Only reload when the USER asked for the update (see rule 3 above).
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (this.userRequestedUpdate) window.location.reload();
      });

      // Look for a new version when the app comes back to the foreground, and every 30 min while open.
      const check = () => void reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
      window.setInterval(check, 30 * 60 * 1000);

      // The offline queue lives in IndexedDB; ask the browser not to evict it under storage pressure.
      void navigator.storage?.persist?.().catch(() => {});
    } catch (err) {
      console.warn('[pwa] service worker registration failed', err);
    }
  }

  // ── actions ──
  /** Native prompt if we have one, otherwise open the manual "how to install" sheet. */
  requestInstall = async (): Promise<InstallOutcome> => {
    if (!this.deferred) {
      this.emit({ sheetOpen: true });
      return 'unavailable';
    }
    const evt = this.deferred;
    this.deferred = null; // a prompt event can be used once
    this.emit();
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      if (outcome === 'accepted') safeSet(INSTALLED_KEY, '1');
      return outcome;
    } catch {
      return 'dismissed';
    }
  };

  openSheet = () => this.emit({ sheetOpen: true });
  closeSheet = () => this.emit({ sheetOpen: false });

  applyUpdate = () => {
    const waiting = this.registration?.waiting;
    if (!waiting) return;
    this.userRequestedUpdate = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  /** True when launched from the home screen / installed window. Safe to call anywhere. */
  isStandalone = () => this.state.installed;

  // ── banner snooze: 3 days after the 1st dismissal, 14 after the 2nd, 60 after that ──
  dismissBanner = () => {
    const prev = readDismiss();
    safeSet(DISMISS_KEY, JSON.stringify({ count: prev.count + 1, at: Date.now() }));
    this.emit();
  };

  isBannerSnoozed = (): boolean => {
    // iOS never tells us an install happened, so once the user has installed anywhere we stay quiet.
    if (safeGet(INSTALLED_KEY) === '1') return true;
    const { count, at } = readDismiss();
    if (count === 0) return false;
    const days = count === 1 ? 3 : count === 2 ? 14 : 60;
    return Date.now() - at < days * 86_400_000;
  };
}

// ── tiny storage helpers (Safari private mode & blocked storage throw) ──
function safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
function safeRemove(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
function readDismiss(): { count: number; at: number } {
  try {
    const v = JSON.parse(safeGet(DISMISS_KEY) || 'null');
    return v && typeof v.count === 'number' ? v : { count: 0, at: 0 };
  } catch { return { count: 0, at: 0 }; }
}

export const pwaManager = new PWAManager();
