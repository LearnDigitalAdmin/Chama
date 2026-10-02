/* MyChama service worker.
 *
 * Build-time placeholders below are replaced by tools/vite-plugin-pwa-seo.ts, so the
 * cache name changes exactly when the app's built files change.
 *
 * Strategy
 *  - Navigations ........ network-first (always fresh), fall back to the cached app shell, then /offline.html
 *  - /assets/* .......... cache-first (content-hashed, immutable), precached at install for offline use
 *  - icons/images/fonts . stale-while-revalidate
 *  - EVERYTHING ELSE .... passes straight through: Firestore, Firebase Auth, Cloud Functions,
 *    Paystack, reCAPTCHA. A financial app must never serve cached API responses.
 *  - /__/ ............... Firebase Auth helper pages: never intercepted.
 *
 * Updates: a new worker installs in the background and WAITS. The app shows "Update available";
 * only the user's tap sends SKIP_WAITING (see src/pwa/pwaManager.ts). No surprise reloads mid-entry.
 */
const BUILD_ID = /*__BUILD_ID__*/ 'dev';
const PRECACHE_ASSETS = /*__PRECACHE_ASSETS__*/ [];

const STATIC_CACHE = `mychama-static-${BUILD_ID}`;
const RUNTIME_CACHE = 'mychama-runtime-v1';

const APP_SHELL = [
  '/', '/index.html', '/offline.html', '/manifest.webmanifest',
  '/icon.svg', '/favicon.ico',
  '/icons/icon-192x192.png', '/icons/icon-512x512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // allSettled: one missing file must never make the whole install fail.
      await Promise.allSettled([...APP_SHELL, ...PRECACHE_ASSETS].map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    })(),
  );
  // Deliberately no skipWaiting() here — see "Updates" above.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('mychama-static-') && k !== STATIC_CACHE).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', buildId: BUILD_ID });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/__/') || url.pathname === '/sw.js') return;
    if (req.mode === 'navigate') return void event.respondWith(handleNavigation(event));
    if (url.pathname.startsWith('/assets/')) return void event.respondWith(cacheFirst(req, STATIC_CACHE));
    if (req.destination === 'image' || req.destination === 'font' || url.pathname === '/manifest.webmanifest') {
      return void event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    }
    return;
  }

  // Web fonts only. Any other cross-origin request (Firebase, Paystack, …) is untouched.
  if (url.hostname === 'fonts.googleapis.com') return void event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
  if (url.hostname === 'fonts.gstatic.com') return void event.respondWith(cacheFirst(req, RUNTIME_CACHE));
});

async function handleNavigation(event) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const res = (await event.preloadResponse) || (await fetch(event.request, { cache: 'no-cache' }));
    const type = res.headers.get('content-type') || '';
    // Every SPA route serves the same index.html, so one cached copy is the offline app shell.
    if (res.ok && !res.redirected && type.includes('text/html')) cache.put('/index.html', res.clone());
    return res;
  } catch {
    return (await cache.match('/index.html')) || (await cache.match('/offline.html')) || Response.error();
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; })
    .catch(() => hit);
  return hit || network;
}
