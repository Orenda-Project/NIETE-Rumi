/**
 * The render matrix in a real browser: headless Chromium at 360×740 (a cheap Android phone),
 * muted, the real page shell (renderQuizPage) and the real /wq/ assets served from this
 * checkout on 127.0.0.1, wq.js served with question() exposed so each case opens straight on
 * its question. Per case, three screens — the question, after a wrong pick, after the right
 * pick — and on each:
 *   - no sideways scroll (document.scrollingElement.scrollWidth ≤ 360);
 *   - no two text boxes overlap (stem, option labels, picture names, match/order slots, why,
 *     feedback, hint), and no two answer controls overlap;
 *   - an option label never spills out of its button;
 *   - every answer control shows a word or a picture of non-zero size (a picture file loaded);
 *   - no maths as raw TeX and no TeX command spelled out in letters;
 *   - Urdu text is set in the page's Nastaliq;
 *   - a question that has a figure shows it, loaded (or, for one that will not draw, the
 *     documented fallback: the PNG when there is one, else the question on its own).
 *
 * playwright-core comes from the bot's dependencies; no browser installed → available() is false.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const E2 = require('./e2');
const { EXPOSED } = require('./vm-page');

const PUB = path.join(__dirname, '..', '..', 'public');
const W = 360;
const H = 740;
const MUTE = 'try{if(window.speechSynthesis){speechSynthesis.speak=function(){};}}catch(e){}';

function pw() {
  try {
    const p = require.resolve('playwright-core', { paths: [path.join(__dirname, '..', '..', '..', 'bot'), path.join(__dirname, '..', '..')] });
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(p);
  } catch (_) { return null; }
}

/** The Chromium to launch, or null (with the reason) when none is installed. */
function available() {
  const p = pw();
  if (!p) return { ok: false, why: 'playwright-core is not installed (bot dependencies)' };
  const exe = process.env.RENDER_MATRIX_CHROMIUM || p.chromium.executablePath();
  if (!exe || !fs.existsSync(exe)) return { ok: false, why: `no Chromium at ${exe || '(none)'}` };
  return { ok: true, exe, chromium: p.chromium };
}

// A plain PNG (no dependency): a pale square with a dark band, so a loaded picture is visible.
function png(w, h, rgb) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const band = y > h * 0.4 && y < h * 0.6;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = band ? rgb[0] : 240; raw[o + 1] = band ? rgb[1] : 240; raw[o + 2] = band ? rgb[2] : 236;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PICTURE = { q: png(320, 200, [0, 82, 147]), A: png(160, 160, [204, 85, 0]), B: png(160, 160, [0, 128, 96]), C: png(160, 160, [96, 64, 160]), D: png(160, 160, [180, 40, 80]) };
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };

/** Serve the cases' pages, the page assets and a stub of the media route. */
function serve(cases) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const rows = new Map(cases.map((c) => [c.row.id, c.row]));
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    if (u.pathname.startsWith('/rm/') && u.pathname.endsWith('.html')) {
      const c = byId.get(decodeURIComponent(u.pathname.slice(4, -5)));
      const html = c && E2.pageHtml(c, `http://127.0.0.1:${srv.address().port}`);
      return html ? send(200, 'text/html; charset=utf-8', html) : send(404, 'text/plain', 'no case');
    }
    if (u.pathname === '/wq/wq.js') return send(200, 'application/javascript', EXPOSED);
    const media = /^\/api\/wq\/media\/[^/]+\/([^/?]+)$/.exec(u.pathname);
    if (media) {
      const row = rows.get(media[1]);
      const k = u.searchParams.get('k') || 'q';
      if (!row) return send(404, 'text/plain', 'no row');
      if (k === 'q' && row.media && row.media.question_image === 'missing-key') return send(404, 'text/plain', 'missing');
      return send(200, 'image/png', PICTURE[k] || PICTURE.q);
    }
    if (u.pathname.startsWith('/api/')) return send(200, 'application/json', '{}');
    const f = path.join(PUB, path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (f.startsWith(PUB) && fs.existsSync(f) && fs.statSync(f).isFile()) return send(200, TYPES[path.extname(f)] || 'application/octet-stream', fs.readFileSync(f));
    return send(404, 'text/plain', 'not found');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

// ─── in-page checks (run inside the page) ─────────────────────────────────────
/* eslint-disable no-undef */
function measureInPage(opts) {
  const faults = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const se = document.scrollingElement;
  if (se.scrollWidth > opts.w) faults.push(`sideways scroll: page is ${se.scrollWidth}px wide`);
  const TEXT = '.wq-qtext, .wq-opt .wq-lab, .wq-pname, .wq-mr .wq-lab, .wq-ml .wq-lab, .wq-mto, .wq-place span, .wq-why, .wq-fb, .wq-small, .wq-hint, .wq-hintbox, .wq-say';
  const texts = Array.from(document.querySelectorAll(TEXT)).filter((e) => vis(e) && e.textContent.trim());
  const name = (e) => (e.className && String(e.className).split(' ')[0]) || e.tagName.toLowerCase();
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]; const b = texts[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ov = inter(a.getBoundingClientRect(), b.getBoundingClientRect());
      if (ov > 6) faults.push(`text overlap: ${name(a)} × ${name(b)} (${Math.round(ov)}px²)`);
    }
  }
  const ctrls = Array.from(document.querySelectorAll('[data-slot]:not(.wq-place)')).filter(vis);
  for (let i = 0; i < ctrls.length; i++) {
    for (let j = i + 1; j < ctrls.length; j++) {
      const ov = inter(ctrls[i].getBoundingClientRect(), ctrls[j].getBoundingClientRect());
      if (ov > 6 && !ctrls[i].classList.contains('wq-hot')) faults.push(`answers overlap: ${ctrls[i].getAttribute('data-slot')} × ${ctrls[j].getAttribute('data-slot')}`);
    }
  }
  for (const b of ctrls) {
    if (b.classList.contains('wq-hot')) continue;
    const br = b.getBoundingClientRect();
    if (br.right > opts.w + 1 || br.left < -1) faults.push(`answer ${b.getAttribute('data-slot')} runs off the screen`);
    b.querySelectorAll('.wq-lab, .wq-pname').forEach((l) => {
      if (!vis(l)) return;
      const lr = l.getBoundingClientRect();
      if (lr.right > br.right + 1 || lr.left < br.left - 1) faults.push(`answer ${b.getAttribute('data-slot')}: label spills out of its button`);
    });
    const words = Array.from(b.querySelectorAll('.wq-lab, .wq-pname, .wq-emoji, .wq-glyph')).filter(vis).map((x) => x.textContent.trim()).join('');
    const pics = Array.from(b.querySelectorAll('.wq-pic svg, .wq-pic, img, .wq-glyph, math')).filter(vis);
    const broken = Array.from(b.querySelectorAll('img')).filter((im) => !(im.complete && im.naturalWidth > 0));
    if (broken.length) faults.push(`answer ${b.getAttribute('data-slot')}: picture did not load`);
    if (!words && !pics.length) faults.push(`answer ${b.getAttribute('data-slot')} is blank`);
  }
  const root = document.getElementById('wq');
  // Anything the child should see that sits past a screen edge (a pushed-out speaker button, a maths
  // line running off the bubble). A child inside a scrolling box that is itself on screen is fine.
  const clipped = (e) => {
    for (let p = e.parentElement; p && p !== root; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') return true;
    }
    return false;
  };
  const off = new Set();
  if (root) {
    root.querySelectorAll('*').forEach((e) => {
      if (e.closest('svg, math') && !/^(svg|math)$/i.test(e.tagName)) return;
      if (!vis(e) || clipped(e) || getComputedStyle(e).position === 'fixed') return;
      const r = e.getBoundingClientRect();
      if (r.right > opts.w + 1 || r.left < -1) off.add(name(e));
    });
  }
  if (off.size) faults.push(`off the screen: ${Array.from(off).slice(0, 4).join(', ')}`);
  const shown = root ? root.innerText : '';
  const raw = /\$[^$\n]+\$/.exec(shown) || /\\[a-zA-Z]+/.exec(shown);
  if (raw) faults.push(`raw TeX shown: ${raw[0].slice(0, 40)}`);
  document.querySelectorAll('math mi').forEach((mi) => { if (Array.from(mi.textContent).length > 1) faults.push(`TeX command shown as letters: ${mi.textContent}`); });
  if (document.querySelector('.katex-error')) faults.push('KaTeX error');
  if (opts.lang === 'ur') {
    const urdu = /[؀-ۿ]/;
    const els = Array.from(document.querySelectorAll('.wq-qtext, .wq-lab, .wq-pname, .wq-why, .wq-fb')).filter((e) => vis(e) && urdu.test(e.textContent));
    for (const e of els) {
      const fam = getComputedStyle(e).fontFamily;
      if (!/^"?WQ Nastaliq/.test(fam)) { faults.push(`Urdu not in Nastaliq: ${name(e)} (${fam.slice(0, 30)})`); break; }
    }
    if (els.length && !document.fonts.check('20px "WQ Nastaliq"', 'ب')) faults.push('Nastaliq font did not load');
  }
  if (opts.figure) {
    const fig = document.querySelector('.wq-fig');
    const art = fig && fig.querySelector('.wq-svg svg, img');
    const failed = art && art.tagName === 'IMG' && art.complete && !(art.naturalWidth > 0);
    // The documented fallback for a file that never arrives: the figure hides itself, the question plays on its words.
    if (failed && vis(art)) faults.push('figure picture did not load (broken image shown)');
    else if (!failed && (!art || !vis(art))) faults.push(`figure missing (${opts.figure})`);
  }
  return { faults, kind: (document.querySelector('.wq-item') || {}).dataset ? document.querySelector('.wq-item').dataset.kind : null };
}

/** Tap an answer the way a child does, through the page's own wire(). */
async function tap(page, kind, answer) {
  const slots = String(answer).split(',');
  if (kind === 'order') {
    for (const s of slots) await page.click(`.wq-pool [data-slot="${s}"]`);
    await page.click('#wq-check');
  } else if (kind === 'match') {
    for (let i = 0; i < slots.length; i++) {
      await page.click(`.wq-ml[data-i="${i}"]`);
      await page.click(`.wq-mr[data-slot="${slots[i]}"]`);
    }
    await page.click('#wq-check');
  } else if (kind === 'multi') {
    for (const s of slots) await page.click(`.wq-opt[data-slot="${s}"]`);
    await page.click('#wq-check');
  } else if (kind === 'label') {
    await page.click(`.wq-hot[data-slot="${slots[0]}"]`);
  } else {
    await page.click(`.wq-opt[data-slot="${slots[0]}"]`);
  }
  await page.waitForSelector('#wq-next', { timeout: 4000 });
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 4000 }).catch(() => {});
}

/**
 * Run the matrix. cases: from shapes.cases(). Options: pngDir (save a PNG per failing screen
 * and the first case of every shape in each language), onCase(result).
 * @returns {Promise<Array<{id, shape, mut, lang, kind, screens:{question,wrong,right}, faults:string[], png:string[]}>>}
 */
async function run(cases, { pngDir = null, onCase = null, shotEvery = false } = {}) {
  const av = available();
  if (!av.ok) throw new Error(av.why);
  const live = cases.map((c) => ({ c, q: E2.question(c) })).filter((x) => x.q);
  const srv = await serve(live.map((x) => x.c));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await av.chromium.launch({ executablePath: av.exe, args: ['--mute-audio'] });
  const out = [];
  const shotShape = new Set();
  try {
    const ctx = await browser.newContext({
      viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 WhatsApp/2.24',
    });
    await ctx.addInitScript(MUTE);
    const page = await ctx.newPage();
    for (const { c, q } of live) {
      const r = { id: c.id, shape: c.shape, mut: c.mut, lang: c.lang, kind: null, screens: {}, faults: [], png: [] };
      const figure = q.figure ? (q.figure.kind || 'figure') : null;
      const a = E2.answers(q);
      try {
        await page.goto(`${base}/rm/${encodeURIComponent(c.id)}.html`, { waitUntil: 'load' });
        await page.waitForFunction(() => !!(window.__wq && window.__wq.question));
        for (const screen of ['question', 'wrong', 'right']) {
          await page.evaluate(() => { window.scrollTo(0, 0); window.__wq.question(0); });
          await settle(page);
          let kind = await page.evaluate(() => (document.querySelector('.wq-item') || { dataset: {} }).dataset.kind);
          r.kind = kind;
          if (screen !== 'question') { await tap(page, kind, screen === 'wrong' ? a.wrong : a.right); await settle(page); }
          const m = await page.evaluate(measureInPage, { w: W, lang: c.lang, figure });
          r.screens[screen] = m.faults;
          r.faults.push(...m.faults.map((f) => `${screen}: ${f}`));
          const first = !shotShape.has(`${c.shape}.${c.lang}.${screen}`);
          if (pngDir && (m.faults.length || (first && screen !== 'right') || shotEvery)) {
            shotShape.add(`${c.shape}.${c.lang}.${screen}`);
            const file = path.join(pngDir, `${c.id}.${screen}${m.faults.length ? '.FAIL' : ''}.png`);
            await page.screenshot({ path: file, fullPage: true });
            r.png.push(file);
          }
          kind = null;
        }
      } catch (e) {
        r.faults.push(`did not render: ${String(e.message || e).split('\n')[0].slice(0, 160)}`);
        if (pngDir) { const file = path.join(pngDir, `${c.id}.ERROR.png`); await page.screenshot({ path: file, fullPage: true }).catch(() => {}); r.png.push(file); }
      }
      out.push(r);
      if (onCase) onCase(r);
    }
  } finally {
    await browser.close();
    srv.close();
  }
  return out;
}

module.exports = { run, available, serve, W, H };
