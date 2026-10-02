# Brand tool

Turns `samuhia-site-logo-studio.html` into every icon, splash screen and social card a PWA needs. The HTML stays the single source of truth.

```bash
cd tools/brand
npm install
node apply-brand.mjs --list
node apply-brand.mjs --brand mychama                       # into this repo's public/
node apply-brand.mjs --brand myregister --target ../../../Register   # into another repo
node apply-brand.mjs --brand mychama --dry-run             # preview only
```

Writes `favicon.ico`, `icon.svg`, `favicon.svg`, `og-image.png`, `icons/*` (favicons, 72–512 px icons, maskable icons fitted to the safe zone, Apple touch icon, 20 Apple splash screens) and `brand/*` (SVG/PNG logos, `head-snippet.html`). It also updates `icons`, `theme_color` and `background_color` in the manifest, and syncs `theme-color` in `index.html`. Nothing else in either file is touched.

Options: `--theme`, `--background`, `--no-manifest`, `--no-html`, `--no-splash`, `--no-og`, `--legacy` (browserconfig.xml), `--studio <file>`, `--public <dir>`.

Re-run any time the logo changes; commit the output. If you re-export the studio HTML with new brands, `--list` shows them automatically.
