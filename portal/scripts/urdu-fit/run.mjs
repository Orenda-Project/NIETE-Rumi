#!/usr/bin/env node
/**
 * bd-fmf24g.24 — does Urdu (Noto Nastaliq) fit its boxes? Measured, not eyeballed.
 *
 *   cd portal && node scripts/urdu-fit/run.mjs [--lang ur|en] [--save-en file] [--compare-en file] [--png dir]
 *
 * Starts a local vite dev server on harness.html (the teacher kit with sample copy; no live app, no data), opens it
 * in headless Chromium at phone width and, for every box that CLIPS (overflow hidden/clip: line-clamp, truncate,
 * overflow-hidden cards, fixed-height tiles) and holds Urdu text, runs two checks:
 *
 *   1. layout  scrollHeight <= clientHeight (the content's line boxes fit the box);
 *   2. ink     the box's top and bottom edges, drawn with its clip ON, must equal the same strips drawn with the clip
 *              OFF. Nastaliq's ink (tall ascenders, deep descenders) reaches well past its line box, so a box can
 *              pass 1 and still cut the glyphs: only the pixels tell.
 *
 * Exit 1 when any Urdu box fails. `--lang en` renders the English page and (with --save-en / --compare-en) proves
 * English is untouched: a hash of every case's pixels and of every element's geometry.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const LANG = arg('lang', 'ur');
const SAVE_EN = arg('save-en');
const COMPARE_EN = arg('compare-en');
const PNG_DIR = arg('png');
const LH = arg('lh'); // try another line-height for every Urdu line without editing the CSS (a sweep)
const CASES = ['main', 'tray', 'nav'];
const STRIP = 30; // CSS px above and below a box that the ink check looks at

function findChromium() {
  const base = path.join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(base)) return undefined;
  const dirs = readdirSync(base).sort().reverse();
  for (const d of dirs) {
    for (const rel of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = path.join(base, d, rel);
      if (/^chromium/.test(d) && existsSync(p)) return p;
    }
  }
  return undefined;
}

/** The app's few `.cjs` helpers (src/lib) are interop-converted by the production build only; do it for the dev server. */
const cjsToEsm = {
  name: 'urdu-fit-cjs',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?')[0];
    if (!file.endsWith('.cjs') || !file.startsWith(path.join(root, 'src'))) return null;
    const m = /module\.exports\s*=\s*\{([^}]*)\}/.exec(code);
    const names = m ? m[1].split(',').map((x) => x.split(':')[0].trim()).filter(Boolean) : [];
    return {
      code: `const module = { exports: {} };\nconst exports = module.exports;\n${code}\nconst __m = module.exports;\nexport default __m;\n${names.map((n) => `const __e_${n} = __m.${n}; export { __e_${n} as ${n} };`).join('\n')}\n`,
      map: null,
    };
  },
};

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  plugins: [cjsToEsm, react()],
  resolve: {
    alias: [
      { find: /^\.\.\/components\/PortalLayout$/, replacement: path.join(here, 'PortalLayoutStub.tsx') },
      { find: '@', replacement: path.join(root, 'src') },
    ],
  },
  server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { strict: false } },
});
await server.listen();
const addr = server.httpServer.address();
const origin = `http://127.0.0.1:${addr.port}`;

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium() });
} catch (e) {
  await server.close();
  throw e;
}

const ARABIC = '[\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF]';
const failures = [];
const overflows = [];
const notes = [];
const enHashes = {};

/** In the page: tag every nearest clipping ancestor of an Urdu text node; return what each one is. */
function collect(arabicSrc) {
  const hasArabic = new RegExp(arabicSrc);
  const found = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue || '').trim();
    if (!text || !hasArabic.test(text)) continue;
    const parent = n.parentElement;
    if (!parent || getComputedStyle(parent).visibility === 'hidden') continue;
    const px = parseFloat(getComputedStyle(parent).fontSize);
    const entry = { text, fontPx: px, line: getComputedStyle(parent).lineHeight };
    let el = parent;
    let clip = null;
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      if (cs.overflowY === 'hidden' || cs.overflowY === 'clip') { clip = el; break; }
      el = el.parentElement;
    }
    entry.clip = clip;
    const key = clip ?? parent;
    if (!found.has(key)) found.set(key, []);
    found.get(key).push(entry);
  }
  const out = [];
  let i = 0;
  for (const [el, entries] of found) {
    const withClip = entries.some((e) => e.clip);
    const id = `c${i++}`;
    el.setAttribute('data-urdu-id', id);
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue; // sr-only text
    const host = el.closest('[data-case]');
    out.push({
      id,
      clipped: withClip,
      case: host ? host.getAttribute('data-case') : '(page)',
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute('class') || '').split(/\s+/).filter((c) => /clamp|truncate|overflow|leading|h-\[|text-\[/.test(c)).join(' '),
      text: entries[0].text.slice(0, 28),
      fontPx: Math.min(...entries.map((e) => e.fontPx)),
      line: entries[0].line,
      x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height,
      overflowPx: Math.max(0, el.scrollHeight - el.clientHeight),
    });
  }
  return out;
}


/**
 * bd-fmf24g.25 — the OTHER half of fit: a box with a FIXED height (Tailwind h-[52px], h-9, size-8, an inline height)
 * whose Urdu content spills out of it. Nothing clips, so the clip check above never sees it: the "پلان #" prefix over
 * the number in ListRow's 52px lead hung out of the box. In the page: every such element holding Urdu text whose
 * descendant boxes (or its own text) cross its border box by more than a pixel.
 */
function collectOverflow(arabicSrc) {
  const hasArabic = new RegExp(arabicSrc);
  const fixed = /(^|\s)(h|size)-(\[|\d|px)/;
  const out = [];
  for (const el of document.querySelectorAll('#root *')) {
    if (el.closest('svg')) continue;
    const cls = el.getAttribute('class') || '';
    if (!hasArabic.test(el.textContent || '')) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    // Fixed = a height class / inline height, OR measurably so: with `height:auto` the box would be taller.
    let isFixed = fixed.test(cls) || /(^|;)\s*height:\s*\d/.test(el.getAttribute('style') || '');
    if (!isFixed) {
      const keep = [el.style.getPropertyValue('height'), el.style.getPropertyPriority('height'), el.style.getPropertyValue('min-height'), el.style.getPropertyPriority('min-height')];
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('min-height', '0', 'important');
      isFixed = el.getBoundingClientRect().height > r.height + 1;
      el.style.removeProperty('height'); el.style.removeProperty('min-height');
      if (keep[0]) el.style.setProperty('height', keep[0], keep[1]);
      if (keep[2]) el.style.setProperty('min-height', keep[2], keep[3]);
    }
    if (!isFixed) continue;
    let worst = 0;
    let what = '';
    for (const d of el.querySelectorAll('*')) {
      if (d.closest('svg') && d.tagName.toLowerCase() !== 'svg') continue;
      const cs = getComputedStyle(d);
      if (cs.position === 'absolute' || cs.position === 'fixed' || cs.display === 'none') continue;
      if (!d.textContent?.trim() && d.tagName.toLowerCase() !== 'svg') continue;
      const q = d.getBoundingClientRect();
      if (q.width <= 0 || q.height <= 0) continue;
      const over = Math.max(r.top - q.top, q.bottom - r.bottom);
      if (over > worst) { worst = over; what = `${d.tagName.toLowerCase()} "${(d.textContent || '').trim().slice(0, 14)}"`; }
    }
    if (worst > 1) {
      const host = el.closest('[data-case]');
      out.push({ case: host ? host.getAttribute('data-case') : '(page)', tag: el.tagName.toLowerCase(), cls: cls.split(/\s+/).filter((c) => /^(h|size|min-h)-|leading/.test(c)).join(' '), boxH: Math.round(r.height * 10) / 10, overPx: Math.round(worst * 10) / 10, what });
    }
  }
  return out;
}

/** Device pixels that differ clearly between two same-size PNGs (decoded in the page, so no image dependency). */
const NOISE_FLOOR = 8; // a lone diacritic dot grazing the edge (3 device px) is not a cut word; a clipped line is thousands
async function differing(page, a, b) {
  if (Buffer.compare(a, b) === 0) return 0;
  return page.evaluate(async ([x, y]) => {
    const load = async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, bmp.width, bmp.height).data;
    };
    const [pa, pb] = [await load(x), await load(y)];
    let n = 0;
    for (let i = 0; i < pa.length; i += 4) if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 96) n += 1;
    return n;
  }, [a.toString('base64'), b.toString('base64')]);
}

try {
  for (const which of CASES) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(`[${which}] page error:`, e.message));
    await page.goto(`${origin}/scripts/urdu-fit/harness.html?lang=${LANG}&case=${which}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForSelector('#root *', { state: 'attached', timeout: 30000 });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    if (LH) await page.addStyleTag({ content: `html[lang="ur"] body *:not(svg):not(svg *):not(h1):not(h2):not(h3):not(p){line-height:${LH}!important}` });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await page.setViewportSize({ width: 390, height: Math.max(844, height) });
    await page.waitForTimeout(150);

    if (PNG_DIR) {
      mkdirSync(PNG_DIR, { recursive: true });
      await page.screenshot({ path: path.join(PNG_DIR, `${which}-${LANG}.png`) });
    }
    if (LANG === 'en') {
      const shot = await page.screenshot();
      const geometry = await page.evaluate(() => Array.from(document.querySelectorAll('#root *')).map((e) => {
        const r = e.getBoundingClientRect();
        return [e.tagName, Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10].join(',');
      }));
      enHashes[which] = { pixels: createHash('sha1').update(shot).digest('hex'), geometry: createHash('sha1').update(geometry.join('|')).digest('hex'), elements: geometry.length };
    }

    if (LANG === 'ur') {
      const spill = await page.evaluate(collectOverflow, ARABIC);
      for (const o of spill) overflows.push({ which, ...o });
      console.log(`[${LANG}/${which}] ${spill.length} fixed-height box(es) overflow`);
    }

    // From here only TEXT may draw: a card's shadow, a negative-margin button or an icon that pokes out of a box is
    // not a cut glyph, and would read as one in the strip comparison.
    await page.addStyleTag({ content: '*,*::before,*::after{background:none!important;border-color:transparent!important;box-shadow:none!important;outline:none!important;color:#000!important;text-shadow:none!important}svg,img,canvas,i,u{visibility:hidden!important}' });
    if (which === 'main') {
      // The strip's height is reserved by NoticeHost (trayHeight) so the page's last row stays above it: it must be exact.
      const strip = await page.evaluate(() => ({ real: document.querySelector('[data-testid="notice-tray"]')?.getBoundingClientRect().height ?? 0, reserved: window.__trayHeight }));
      if (Math.abs(strip.real - strip.reserved) > 1) failures.push({ which, case: 'ReadyTray', tag: 'div', cls: 'notice-tray', text: '', fontPx: 0, line: '', problems: [`strip is ${strip.real}px but trayHeight reserves ${strip.reserved}px`] });
    }
    const boxes = await page.evaluate(collect, ARABIC);
    const urduBoxes = boxes.filter((b) => b.clipped);
    for (const b of boxes) {
      if (b.fontPx < 13) notes.push(`[${which}] ${b.case}: Urdu text at ${b.fontPx}px (< 13px) "${b.text}"`);
    }
    for (const b of urduBoxes) {
      const problems = [];
      if (b.overflowPx > 1) problems.push(`layout: content ${b.overflowPx}px taller than the box`);
      const sel = `[data-urdu-id="${b.id}"]`;
      const strips = [
        ['top', { x: Math.max(0, b.x), y: Math.max(0, b.y - STRIP), width: Math.min(b.w, 390 - Math.max(0, b.x)), height: Math.min(STRIP, b.y) }],
        ['bottom', { x: Math.max(0, b.x), y: b.y + b.h, width: Math.min(b.w, 390 - Math.max(0, b.x)), height: STRIP }],
      ].filter(([, c]) => c.width > 1 && c.height > 1 && c.y + c.height <= Math.max(844, height));
      const shoot = (c) => page.screenshot({ clip: c });
      const before = [];
      const noise = [];
      for (const [, c] of strips) { before.push(await shoot(c)); noise.push(await shoot(c)); }
      await page.evaluate((s) => document.querySelector(s).style.setProperty('overflow', 'visible', 'important'), sel);
      for (let i = 0; i < strips.length; i += 1) {
        const open = await shoot(strips[i][1]);
        if (await differing(page, before[i], noise[i])) { notes.push(`[${which}] ${b.case}: ${strips[i][0]} strip of <${b.tag}> "${b.text}" is unstable, skipped`); continue; }
        const cut = await differing(page, before[i], open);
        if (cut > NOISE_FLOOR) {
          problems.push(`ink: ${strips[i][0]} edge cuts the glyphs (${cut} device px)`);
          if (PNG_DIR) {
            writeFileSync(path.join(PNG_DIR, `cut-${which}-${b.id}-${strips[i][0]}-clipped.png`), before[i]);
            writeFileSync(path.join(PNG_DIR, `cut-${which}-${b.id}-${strips[i][0]}-open.png`), open);
          }
        }
      }
      await page.evaluate((s) => document.querySelector(s).style.removeProperty('overflow'), sel);
      if (problems.length) failures.push({ which, ...b, problems });
    }
    console.log(`[${LANG}/${which}] ${boxes.length} Urdu boxes, ${urduBoxes.length} clipping`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (LANG === 'en') {
  if (SAVE_EN) { writeFileSync(SAVE_EN, JSON.stringify(enHashes, null, 2)); console.log(`English baseline saved: ${SAVE_EN}`); }
  if (COMPARE_EN) {
    const base = JSON.parse(readFileSync(COMPARE_EN, 'utf8'));
    let drift = 0;
    for (const k of Object.keys(base)) {
      for (const f of ['pixels', 'geometry']) {
        if (base[k][f] !== enHashes[k]?.[f]) { drift += 1; console.log(`ENGLISH CHANGED: ${k} ${f}`); }
      }
    }
    console.log(drift ? `English drifted in ${drift} place(s)` : 'English pixel- and geometry-identical to the baseline');
    process.exit(drift ? 1 : 0);
  }
  process.exit(0);
}

for (const n of notes) console.log(`note: ${n}`);
console.log(`OVERFLOW COUNT: ${overflows.length}`);
for (const o of overflows) console.log(` - [${o.which}] ${o.case} <${o.tag} ${o.cls}> box ${o.boxH}px, ${o.what} sticks out ${o.overPx}px`);
console.log(`CLIP COUNT: ${failures.length}`);
if (overflows.length) process.exitCode = 1;
if (failures.length) {
  console.log(`\nFAIL: ${failures.length} Urdu box(es) cut their text`);
  for (const f of failures) console.log(` - [${f.which}] ${f.case} <${f.tag} ${f.cls}> "${f.text}" (${f.fontPx}px, line-height ${f.line}): ${f.problems.join('; ')}`);
  process.exit(1);
}
if (overflows.length) { console.log(`\nFAIL: ${overflows.length} fixed-height box(es) overflow`); process.exit(1); }
console.log('\nPASS: no Urdu box cuts its text or spills out of its box');
