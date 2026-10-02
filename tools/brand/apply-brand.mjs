#!/usr/bin/env node
/**
 * apply-brand.mjs — SAMUHIA Logo Studio → every icon a PWA site needs.
 *
 * Reads the brand definitions straight out of samuhia-site-logo-studio.html
 * (the `const B = {...}` object) so the HTML stays the single source of truth,
 * then writes into <target>/public:
 *
 *   favicon.svg  icon.svg  favicon.ico  og-image.png
 *   icons/favicon-{16,32,48}x*.png
 *   icons/icon-{72,96,128,144,152,192,384,512}x*.png          (purpose: any)
 *   icons/manifest-icon-{192,512}.maskable.png                 (purpose: maskable, safe-zone fitted)
 *   icons/apple-touch-icon.png (+ -180x180, apple-icon-180 aliases)
 *   icons/apple-splash-<W>-<H>.png                             (20 iPhone/iPad portrait sizes)
 *   brand/{symbol,icon,lockup,lockup-reversed}.svg  + lockup PNGs + brand.json
 *   brand/head-snippet.html                                    (paste-ready <head> tags)
 *
 * and (unless --no-manifest) updates icons / theme_color / background_color in
 * the site's web manifest, leaving every other manifest field alone.
 *
 * Usage (from a repo root that contains this tools/brand folder):
 *   cd tools/brand && npm install
 *   node apply-brand.mjs --list
 *   node apply-brand.mjs --brand mychama
 *   node apply-brand.mjs --brand myregister --target /path/to/Register
 *   node apply-brand.mjs --brand mychama --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ───────────────────────────── CLI ─────────────────────────────
const HELP = `
SAMUHIA brand tool

  node apply-brand.mjs --list
  node apply-brand.mjs --brand <key> [options]

Options
  --brand <key>          Brand key from the studio (see --list)          [required]
  --studio <file>        Studio HTML file       (default: ./samuhia-site-logo-studio.html)
  --target <dir>         Repo root to write into (default: two levels above this script)
  --public <dir>         Public folder inside target                      (default: public)
  --manifest <file>      Manifest path inside the public folder           (default: auto-detect)
  --theme <#hex>         theme_color override                              (default: icon tile colour)
  --background <#hex>    background_color / splash colour override         (default: icon tile colour)
  --no-manifest          Do not touch the web manifest
  --html <file>          index.html (relative to target) whose theme-color / msapplication-TileColor
                         meta tags get synced to the brand colour     (default: index.html if present)
  --no-html              Do not touch index.html
  --no-splash            Skip the 20 Apple splash screens
  --no-og                Skip og-image.png
  --legacy               Also write browserconfig.xml (old Edge/IE tiles)
  --dry-run              Show what would be written, write nothing
  --help                 This text
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || process.argv.length <= 2) { console.log(HELP); process.exit(0); }

// ─────────────────────── read the studio HTML ───────────────────────
function loadStudio(file) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('const B=');
  if (start < 0) throw new Error(`Could not find "const B=" in ${file}. Is this the SAMUHIA Logo Studio file?`);
  const open = src.indexOf('{', start);
  let depth = 0, quote = null, esc = false, end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i; break; }
  }
  if (end < 0) throw new Error('Unbalanced braces while reading the brand object.');
  return vm.runInNewContext('(' + src.slice(open, end + 1) + ')', {}, { timeout: 2000 });
}

const studioFile = path.resolve(args.studio && args.studio !== true ? args.studio : path.join(HERE, 'samuhia-site-logo-studio.html'));
const brands = loadStudio(studioFile);

if (args.list) {
  console.log(`Brands in ${path.basename(studioFile)}:\n`);
  for (const [key, b] of Object.entries(brands)) console.log(`  ${key.padEnd(12)} ${b.n} ${b.s}   primary ${b.P}  accent ${b.A}`);
  process.exit(0);
}

const brandKey = args.brand;
if (!brandKey || brandKey === true || !brands[brandKey]) {
  console.error(`Unknown or missing --brand. Available: ${Object.keys(brands).join(', ')}`);
  process.exit(1);
}
const brand = brands[brandKey];

const target = path.resolve(args.target && args.target !== true ? args.target : path.join(HERE, '..', '..'));
const publicDir = path.join(target, args.public && args.public !== true ? args.public : 'public');
const DRY = !!args['dry-run'];

// ───────────────────────────── helpers ─────────────────────────────
const written = [];
function write(rel, data) {
  const file = path.join(publicDir, rel);
  written.push({ rel, bytes: Buffer.byteLength(data) });
  if (DRY) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

const viewBoxOf = (svg) => {
  const m = svg.match(/viewBox="([-\d.\s]+)"/);
  if (!m) throw new Error('SVG has no viewBox');
  const [, , w, h] = m[1].trim().split(/\s+/).map(Number);
  return { w, h };
};
const withSize = (svg, w, h) =>
  svg.replace(/^<svg([^>]*)>/, (_, attrs) => `<svg${attrs.replace(/\s(?:width|height)="[^"]*"/g, '')} width="${w}" height="${h}">`);
const toPng = (svg, w, h) => sharp(Buffer.from(withSize(svg, w, h)), { density: 72 }).png({ compressionLevel: 9 }).toBuffer();
// Flat colour + crisp glyph: a palette PNG is ~5x smaller than a JPEG here and has no ringing.
const toSplash = (svg, w, h) => sharp(Buffer.from(withSize(svg, w, h)), { density: 72 }).flatten().png({ palette: true, quality: 100, compressionLevel: 9 }).toBuffer();

/** The studio icon is: <svg><rect tile/><glyph…/></svg>. Split it so we can re-compose it. */
function splitIcon(iconSvg) {
  const re = /<rect\s+width="200"\s+height="200"\s+rx="([\d.]+)"\s+fill="(#[0-9a-fA-F]{3,8})"\s*\/>/;
  const m = iconSvg.match(re);
  if (!m) throw new Error('Icon SVG is not in the expected "tile rect + glyph" format.');
  const glyph = iconSvg.replace(re, '').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return { bg: m[2], radius: Number(m[1]), glyph };
}

/** Bounding box (in the 200×200 icon space) of the drawn glyph, measured from real pixels. */
async function glyphBox(glyph) {
  const N = 800;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${N}" height="${N}">${glyph}</svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const k = 200 / N;
  return { x0: x0 * k, y0: y0 * k, x1: (x1 + 1) * k, y1: (y1 + 1) * k };
}

/** ICO container holding PNG frames (supported everywhere since Vista). */
function buildIco(frames) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
  let offset = 6 + 16 * frames.length;
  const dir = frames.map(({ size, buf }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
    offset += buf.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...frames.map((f) => f.buf)]);
}

const SPLASH = [
  [640, 1136, 320, 568, 2], [750, 1334, 375, 667, 2], [828, 1792, 414, 896, 2], [1125, 2436, 375, 812, 3],
  [1170, 2532, 390, 844, 3], [1179, 2556, 393, 852, 3], [1206, 2622, 402, 874, 3], [1242, 2208, 414, 736, 3],
  [1242, 2688, 414, 896, 3], [1260, 2736, 420, 912, 3], [1284, 2778, 428, 926, 3], [1290, 2796, 430, 932, 3],
  [1320, 2868, 440, 956, 3], [1488, 2266, 744, 1133, 2], [1536, 2048, 768, 1024, 2], [1620, 2160, 810, 1080, 2],
  [1640, 2360, 820, 1180, 2], [1668, 2224, 834, 1112, 2], [1668, 2388, 834, 1194, 2], [2048, 2732, 1024, 1366, 2],
];
const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

// ───────────────────────────── build ─────────────────────────────
const { bg, glyph } = splitIcon(brand.I);
const box = await glyphBox(glyph);
const gw = box.x1 - box.x0, gh = box.y1 - box.y0;
const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
const theme = typeof args.theme === 'string' ? args.theme : bg;
const backdrop = typeof args.background === 'string' ? args.background : bg;

console.log(`\nBrand: ${brand.n} ${brand.s}  (${brandKey})`);
console.log(`Studio: ${studioFile}`);
console.log(`Output: ${publicDir}${DRY ? '   [dry run]' : ''}\n`);

// 1) SVGs
write('icon.svg', brand.I);
write('favicon.svg', brand.I);
write('brand/icon.svg', brand.I);
write('brand/symbol.svg', brand.Y);
write('brand/lockup.svg', brand.L);
write('brand/lockup-reversed.svg', brand.D);

// 2) "any" PNG icons (rounded tile, transparent corners)
for (const s of [16, 32, 48]) write(`icons/favicon-${s}x${s}.png`, await toPng(brand.I, s, s));
for (const s of ICON_SIZES) write(`icons/icon-${s}x${s}.png`, await toPng(brand.I, s, s));
const apple = await toPng(brand.I.replace(/rx="[\d.]+"/, 'rx="0"'), 180, 180); // iOS applies its own mask; needs an opaque square
write('icons/apple-touch-icon.png', apple);
write('icons/apple-touch-icon-180x180.png', apple);
write('icons/apple-icon-180.png', apple);

// 3) favicon.ico (16 + 32 + 48)
write('favicon.ico', buildIco(await Promise.all([16, 32, 48].map(async (size) => ({ size, buf: await toPng(brand.I, size, size) })))));

// 4) maskable icons: full-bleed square, glyph re-centred and fitted inside the 80% safe circle
const halfDiag = Math.hypot(gw, gh) / 2;
const fit = Math.min(1, 76 / halfDiag); // safe-zone radius is 40% of 200 = 80; keep 4 units of slack
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/><g transform="translate(100 100) scale(${fit.toFixed(4)}) translate(${(-cx).toFixed(3)} ${(-cy).toFixed(3)})">${glyph}</g></svg>`;
write('icons/manifest-icon-192.maskable.png', await toPng(maskable, 192, 192));
write('icons/manifest-icon-512.maskable.png', await toPng(maskable, 512, 512));

// 5) lockup PNGs for docs / e-mail / social
for (const [name, svg] of [['lockup', brand.L], ['lockup-reversed', brand.D]]) {
  const { w, h } = viewBoxOf(svg);
  write(`brand/${name}.png`, await toPng(svg, 1600, Math.round((1600 * h) / w)));
}

// 6) Open Graph / social card 1200×630 — reversed lockup on the brand colour
if (!args['no-og']) {
  const { w, h } = viewBoxOf(brand.D);
  const lw = 780, lh = (lw * h) / w;
  const inner = brand.D.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<defs><radialGradient id="og-g" cx="78%" cy="18%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="630" fill="${bg}"/><rect width="1200" height="630" fill="url(#og-g)"/>
<rect y="606" width="1200" height="24" fill="${brand.A}"/>
<svg x="${(1200 - lw) / 2}" y="${(606 - lh) / 2}" width="${lw}" height="${lh}" viewBox="0 0 ${w} ${h}">${inner}</svg></svg>`;
  write('og-image.png', await toPng(og, 1200, 630));
}

// 7) Apple splash screens: brand colour + centred glyph (≈24% of the short edge)
const splashLinks = [];
if (!args['no-splash']) {
  for (const [W, H, dw, dh, dpr] of SPLASH) {
    const k = (0.24 * Math.min(W, H)) / Math.max(gw, gh);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${backdrop}"/><g transform="translate(${W / 2} ${H / 2}) scale(${k.toFixed(4)}) translate(${(-cx).toFixed(3)} ${(-cy).toFixed(3)})">${glyph}</g></svg>`;
    write(`icons/apple-splash-${W}-${H}.png`, await toSplash(svg, W, H));
    splashLinks.push(`<link rel="apple-touch-startup-image" media="screen and (device-width: ${dw}px) and (device-height: ${dh}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" href="/icons/apple-splash-${W}-${H}.png" />`);
  }
}

// 8) brand.json + paste-ready head snippet
write('brand/brand.json', JSON.stringify({
  key: brandKey, name: brand.n, descriptor: brand.s, primary: brand.P, accent: brand.A,
  darkPrimary: brand.DP, tile: bg, themeColor: theme, backgroundColor: backdrop,
  source: path.basename(studioFile),
}, null, 2) + '\n');

write('brand/head-snippet.html', `<!-- Generated by tools/brand/apply-brand.mjs — brand: ${brandKey} -->
<meta name="theme-color" content="${theme}" />
<link rel="icon" href="/favicon.ico" sizes="48x48" />
<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32x32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16x16.png" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<meta name="msapplication-TileColor" content="${theme}" />
<meta name="msapplication-TileImage" content="/icons/icon-144x144.png" />
${splashLinks.join('\n')}
`);

if (args.legacy) {
  write('browserconfig.xml', `<?xml version="1.0" encoding="utf-8"?>
<browserconfig><msapplication><tile><square150x150logo src="/icons/icon-152x152.png"/><TileColor>${theme}</TileColor></tile></msapplication></browserconfig>
`);
}

// 9) manifest: replace icons + colours only
let manifestNote = 'skipped (--no-manifest)';
if (!args['no-manifest']) {
  const candidates = args.manifest && args.manifest !== true
    ? [args.manifest] : ['manifest.webmanifest', 'manifest.json'];
  const found = candidates.map((c) => path.join(publicDir, c)).find((p) => fs.existsSync(p));
  if (found) {
    const original = fs.readFileSync(found, 'utf8');
    const m = JSON.parse(original);
    const snapshot = JSON.stringify(m);
    const png = (src, s, purpose) => ({ src, sizes: `${s}x${s}`, type: 'image/png', purpose });
    m.icons = [
      png('/icons/icon-192x192.png', 192, 'any'),
      png('/icons/icon-512x512.png', 512, 'any'),
      png('/icons/manifest-icon-192.maskable.png', 192, 'maskable'),
      png('/icons/manifest-icon-512.maskable.png', 512, 'maskable'),
    ];
    m.theme_color = theme;
    m.background_color = backdrop;
    if (JSON.stringify(m) === snapshot) {
      manifestNote = `${path.relative(target, found)}: already up to date`; // don't reformat a file that didn't change
    } else {
      const out = JSON.stringify(m, null, 2) + '\n';
      written.push({ rel: path.relative(publicDir, found) + '  (icons + colours updated)', bytes: Buffer.byteLength(out) });
      if (!DRY) fs.writeFileSync(found, out);
      manifestNote = path.relative(target, found);
    }
  } else {
    manifestNote = 'no manifest found — create one, then re-run (icons array is documented in brand.json / README)';
  }
}

// 10) keep <meta name="theme-color"> / msapplication-TileColor in index.html in sync
let htmlNote = 'skipped (--no-html)';
if (!args['no-html']) {
  const htmlFile = path.join(target, args.html && args.html !== true ? args.html : 'index.html');
  if (fs.existsSync(htmlFile)) {
    let html = fs.readFileSync(htmlFile, 'utf8');
    const before = html;
    html = html
      .replace(/(<meta\s+name="theme-color"\s+content=")[^"]*(")/gi, `$1${theme}$2`)
      .replace(/(<meta\s+name="msapplication-TileColor"\s+content=")[^"]*(")/gi, `$1${theme}$2`);
    if (html !== before) {
      if (!DRY) fs.writeFileSync(htmlFile, html);
      htmlNote = `${path.relative(target, htmlFile)}: theme-color / TileColor set to ${theme}`;
    } else {
      htmlNote = `${path.relative(target, htmlFile)}: already up to date`;
    }
  } else {
    htmlNote = 'no index.html found';
  }
}

// ───────────────────────────── report ─────────────────────────────
const kb = (n) => (n / 1024).toFixed(1).padStart(7) + ' KB';
console.log(written.map((f) => `  ${kb(f.bytes)}  ${f.rel}`).join('\n'));
const total = written.reduce((s, f) => s + f.bytes, 0);
console.log(`\n${written.length} files, ${(total / 1024 / 1024).toFixed(2)} MB${DRY ? ' (dry run — nothing written)' : ''}`);
console.log(`Glyph fitted for maskable at ${(fit * 100).toFixed(0)}% scale · theme ${theme} · background ${backdrop}`);
console.log(`Manifest: ${manifestNote}`);
console.log(`HTML:     ${htmlNote}`);
console.log(`\nNext: make sure your index.html <head> matches public/brand/head-snippet.html\n`);
