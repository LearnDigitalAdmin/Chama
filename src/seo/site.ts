/**
 * Site-wide SEO constants. Pure data (no imports) so BOTH the React app and
 * tools/vite-plugin-pwa-seo.ts (which runs in Node at build time) can import it.
 *
 * Changing the domain? Edit `url` here, then update the three static files that
 * can't import TypeScript: public/robots.txt, public/sitemap.xml, public/llms.txt
 * (see docs/PWA_SEO.md → "Changing the domain").
 */
export const SITE = {
  name: 'MyChama',
  /** Production origin, no trailing slash. */
  url: 'https://chama.samuhia.co.ke',
  /** Publisher. Verify this URL is your live corporate site before deploying. */
  publisher: { name: 'Samuhia', url: 'https://samuhia.co.ke' },
  supportEmail: 'samuhiagroup@gmail.com',
  lang: 'en-KE',
  ogLocale: 'en_KE',
  themeColor: '#0E5C4A',
  ogImage: '/og-image.png',
  ogImageAlt: 'MyChama — chama management app by Samuhia',
} as const;

/** Routes that must never be indexed (also enforced server-side via X-Robots-Tag in firebase.json). */
export const PRIVATE_PATH_PREFIXES = ['/app', '/signin', '/claim', '/create-chama', '/complete-profile'] as const;
