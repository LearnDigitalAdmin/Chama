# PWA, install prompt and SEO

## What was added

| Area | Files |
|---|---|
| Installable app | `public/manifest.webmanifest`, `public/sw.js`, `public/offline.html`, `src/pwa/*` |
| Visible install prompts | `src/pwa/PWAPrompts.tsx` (banner, how-to sheet, update toast), `src/pwa/InstallButton.tsx` (headers), `GetTheApp` section on the landing page |
| Icons / splash / OG | `tools/brand/` generates them from the Logo Studio HTML into `public/` |
| SEO | `index.html` head, `src/seo/*`, `src/marketing/content.ts`, `tools/vite-plugin-pwa-seo.ts`, `public/robots.txt`, `sitemap.xml`, `llms.txt`, generated `llms-full.txt` |
| Hosting | `firebase.json` headers (cache rules, `X-Robots-Tag: noindex` on private routes, security headers) |

## How install prompting works

* **Chrome / Edge / Samsung / Android:** `pwaManager.init()` (called first in `main.tsx`) captures `beforeinstallprompt`. A bottom banner appears ~2.5 s after load on `/`, `/signin` and `/app/*`, plus an "Install app" button in every header and a "Get the MyChama app" section on the landing page.
* **iPhone / Safari / Android Firefox:** these never fire an install event, so the same UI opens a step-by-step sheet ("Share → Add to Home Screen"). In-app browsers (Facebook, Instagram, WhatsApp) get "Open in your browser first".
* **Already installed:** everything hides. Launching the installed app while signed out goes straight to `/signin`.
* **Dismissing:** the banner snoozes 3 days, then 14, then 60. The header button and landing section always remain.

## Updates

A new service worker installs quietly and **waits**. Users see "A new version of MyChama is ready → Update". Only their tap reloads the app, so an admin is never interrupted mid-entry. The cache name is a hash of the built files, so it changes exactly when the app changes.

The worker never touches Firestore, Auth, Cloud Functions or Paystack traffic, and never caches non-GET requests.

## Testing locally

The service worker only registers in production builds:

```bash
npm run build && npx vite preview
```

Open `http://localhost:4173`, then Chrome DevTools → Application → Manifest / Service Workers, and run Lighthouse (PWA + SEO). To test offline: tick "Offline" in DevTools → Network and reload.

## Editing marketing copy

Edit `src/marketing/content.ts` only. The landing page, FAQ structured data, `<noscript>` fallback and `/llms-full.txt` all read from it, so they can't disagree. Plan prices are read from `PLANS` in `src/lib/constants.ts` at build time.

## Changing the domain

Update `SITE.url` in `src/seo/site.ts`, then replace `chama.samuhia.co.ke` in: `index.html`, `public/robots.txt`, `public/sitemap.xml`, `public/llms.txt`.

```bash
grep -rl "chama.samuhia.co.ke" index.html public/robots.txt public/sitemap.xml public/llms.txt src/seo/site.ts \
  | xargs sed -i 's#chama.samuhia.co.ke#YOUR.DOMAIN#g'
```

## After the first deploy

1. Google Search Console → add the property → submit `https://<domain>/sitemap.xml`.
2. Validate structured data with Google's Rich Results Test (FAQ + Software Application).
3. Check social previews (og-image) with the Facebook Sharing Debugger.
4. Lighthouse on mobile: aim for 90+ in PWA, SEO, Best Practices.

## Not done yet (recommended next)

* **Screenshots in the manifest** (`screenshots`: one narrow 1080×1920, one wide 1920×1080 of the real app). Chrome uses them for the richer install dialog. They must be real screenshots, so they aren't included.
* **Content-Security-Policy.** Needs testing against Firebase, reCAPTCHA and Paystack before enabling.
* **Play Store listing** via a Trusted Web Activity (PWABuilder or Bubblewrap) once the site is live; needs `/.well-known/assetlinks.json`.
* **Prerendering / more public pages** (e.g. `/merry-go-round`, `/loans`, `/pricing`) for long-tail search traffic. The site is a client-rendered SPA; Google renders it, but the `<noscript>` block and JSON-LD are what non-JS bots see.
* `public/index.html` is an old static demo that Vite overwrites in `dist`. It is safe to delete.
