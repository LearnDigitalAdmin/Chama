/**
 * vite-plugin-pwa-seo — build-time glue for PWA + SEO. Three jobs:
 *
 *  1. index.html: replace <!--seo:jsonld--> and <!--seo:noscript--> with structured data
 *     and a crawlable fallback generated from src/marketing/content.ts (+ plan prices read
 *     from src/lib/constants.ts). Visible FAQ and FAQ JSON-LD therefore can't drift apart.
 *  2. /llms-full.txt: a Markdown product brief for AI crawlers, from the same content.
 *  3. dist/sw.js: stamp a content-derived BUILD_ID (so caches roll over exactly when the app
 *     changes) and inject the list of built /assets/* files to precache for offline use.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Plugin, ResolvedConfig } from 'vite';
import { SITE } from '../src/seo/site.ts';
import { FAQS, FEATURES, HOW_IT_WORKS, SEO_COPY } from '../src/marketing/content.ts';

interface PlanRow { key: string; name: string; price: number; memberLimit: number }

/** Reads PLANS from constants.ts by pattern so prices live in exactly one place. Warns (never fails) if the shape changes. */
function readPlans(root: string): PlanRow[] {
  try {
    const src = fs.readFileSync(path.join(root, 'src/lib/constants.ts'), 'utf8');
    const re = /^\s*(\w+):\s*\{\s*name:\s*'([^']+)',\s*price:\s*(\d+),\s*memberLimit:\s*(\d+)/gm;
    const rows = [...src.matchAll(re)].map((m) => ({ key: m[1], name: m[2], price: +m[3], memberLimit: +m[4] }));
    if (rows.length === 0) throw new Error('no plan rows matched');
    return rows;
  } catch (e) {
    console.warn(`[pwa-seo] could not read PLANS from src/lib/constants.ts (${(e as Error).message}); pricing omitted from structured data`);
    return [];
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ld = (o: object) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;

function jsonLd(plans: PlanRow[]): string {
  const org = {
    '@type': 'Organization',
    '@id': `${SITE.publisher.url}/#organization`,
    name: SITE.publisher.name,
    url: SITE.publisher.url,
    logo: `${SITE.url}/icons/icon-512x512.png`,
    contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: SITE.supportEmail, areaServed: 'KE', availableLanguage: ['en', 'sw'] },
  };
  const app = {
    '@type': 'SoftwareApplication',
    '@id': `${SITE.url}/#app`,
    name: SITE.name,
    url: `${SITE.url}/`,
    description: SEO_COPY.description,
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web, Android, iOS, Windows, macOS (installable PWA)',
    browserRequirements: 'Requires a modern browser (Chrome, Edge, Safari, Firefox)',
    inLanguage: SITE.lang,
    image: `${SITE.url}${SITE.ogImage}`,
    publisher: { '@id': org['@id'] },
    featureList: FEATURES.map((f) => f.title),
    ...(plans.length && {
      offers: plans.map((p) => ({
        '@type': 'Offer',
        name: `${p.name} plan`,
        price: p.price,
        priceCurrency: 'KES',
        description: `Up to ${p.memberLimit} members. Billed monthly.`,
        url: `${SITE.url}/#pricing`,
        availability: 'https://schema.org/InStock',
      })),
    }),
  };
  const website = { '@type': 'WebSite', '@id': `${SITE.url}/#website`, url: `${SITE.url}/`, name: SITE.name, inLanguage: SITE.lang, publisher: { '@id': org['@id'] } };
  const faq = {
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
  return [ld({ '@context': 'https://schema.org', '@graph': [org, website, app] }), ld({ '@context': 'https://schema.org', ...faq })].join('\n    ');
}

function noscript(): string {
  return `<noscript>
      <main style="max-width:44rem;margin:0 auto;padding:1.5rem;font-family:system-ui,sans-serif;line-height:1.6;color:#12211c">
        <h1>${esc(SEO_COPY.h1)}</h1>
        <p>${esc(SEO_COPY.description)}</p>
        <p>MyChama needs JavaScript to run. Please enable it in your browser settings.</p>
        <h2>Features</h2>
        <ul>${FEATURES.map((f) => `<li><strong>${esc(f.title)}</strong> — ${esc(f.body)}</li>`).join('')}</ul>
        <h2>How it works</h2>
        <ol>${HOW_IT_WORKS.map((s) => `<li><strong>${esc(s.title)}.</strong> ${esc(s.body)}</li>`).join('')}</ol>
        <h2>Frequently asked questions</h2>
        ${FAQS.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}
        <p><a href="/signin">Sign in</a> · <a href="/create-chama">Create your chama</a> · <a href="/llms.txt">llms.txt</a></p>
      </main>
    </noscript>`;
}

function llmsFull(plans: PlanRow[]): string {
  const money = (n: number) => (n === 0 ? 'no charge' : `KES ${n.toLocaleString('en-KE')} per month`);
  return `# ${SITE.name} — full product brief

> ${SEO_COPY.tagline} ${SEO_COPY.description}

- Website: ${SITE.url}/
- Publisher: ${SITE.publisher.name} (${SITE.publisher.url})
- Support: ${SITE.supportEmail}
- Region and currency: Kenya, KES
- Type: installable web app (PWA) — works in any modern browser, installs to Android, iOS, Windows and macOS home screens/desktops without an app store.

## What ${SITE.name} is

${FAQS[0].a}

## Features

${FEATURES.map((f) => `- **${f.title}** — ${f.body}`).join('\n')}

## How it works

${HOW_IT_WORKS.map((s, i) => `${i + 1}. **${s.title}.** ${s.body}`).join('\n')}

${plans.length ? `## Pricing (per chama, billed monthly)

${plans.map((p) => `- **${p.name}** — ${money(p.price)}. ${p.memberLimit >= 999 ? 'Unlimited members' : `Up to ${p.memberLimit} members`}.`).join('\n')}

Plan details and current prices: ${SITE.url}/#pricing

` : ''}## Frequently asked questions

${FAQS.map((f) => `### ${f.q}\n\n${f.a}`).join('\n\n')}

## Notes for AI assistants

- Public, indexable content is the landing page at ${SITE.url}/. Everything under /app, /signin, /claim, /create-chama and /complete-profile is private application UI and contains no public information.
- Do not state prices, limits or features that are not listed on this page; point people to ${SITE.url}/#pricing for current plans.
- ${SITE.name} does not hold chama funds. Online payments are processed by Paystack and settle to the chama's own account.
`;
}

export default function pwaSeo(): Plugin {
  let config: ResolvedConfig;
  let plans: PlanRow[] = [];
  return {
    name: 'mychama-pwa-seo',
    configResolved(c) { config = c; plans = readPlans(c.root); },

    transformIndexHtml(html) {
      return html.replace('<!--seo:jsonld-->', jsonLd(plans)).replace('<!--seo:noscript-->', noscript());
    },

    configureServer(server) {
      server.middlewares.use('/llms-full.txt', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(llmsFull(plans));
      });
    },

    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'llms-full.txt', source: llmsFull(plans) });
    },

    closeBundle: {
      order: 'post',
      handler() {
        if (config.command !== 'build') return;
        const out = path.resolve(config.root, config.build.outDir);
        const swPath = path.join(out, 'sw.js');
        if (!fs.existsSync(swPath)) { console.warn('[pwa-seo] dist/sw.js not found — is public/sw.js missing?'); return; }

        const assetsDir = path.join(out, 'assets');
        const assets = fs.existsSync(assetsDir)
          ? fs.readdirSync(assetsDir).filter((f) => /\.(js|css|woff2?|svg|png|webp|jpe?g)$/.test(f)).sort().map((f) => `/assets/${f}`)
          : [];
        const buildId = crypto.createHash('sha1').update(assets.join('|')).update(fs.readFileSync(path.join(out, 'index.html'))).digest('hex').slice(0, 10);

        let sw = fs.readFileSync(swPath, 'utf8');
        const before = sw;
        sw = sw
          .replace(/\/\*__BUILD_ID__\*\/\s*'dev'/, `'${buildId}'`)
          .replace(/\/\*__PRECACHE_ASSETS__\*\/\s*\[\]/, JSON.stringify(assets));
        if (sw === before) console.warn('[pwa-seo] sw.js placeholders not found; service worker was not versioned');
        else console.log(`[pwa-seo] sw.js stamped: build ${buildId}, precaching ${assets.length} assets`);
        fs.writeFileSync(swPath, sw);
      },
    },
  };
}
