'use strict';
/**
 * The other Urdu word tiles the battery draws (dashboard/sa/sa-ui.js passageEl + fitCells, sa.css .sae-word/.sae-cell):
 * the last-word screen's word tiles (the coach's and the child's, every passage and every rotated variant, printed and
 * plain) and the read-aloud grid cells. At 360x640 and 390x844 every word's ink is inside its tile. Nastaliq ink
 * (the tail of «ج», «م», «ے») reaches well past the font's line box, so a tile sized for the line lets it spill.
 * Needs a real browser (playwright-core, PWCORE=<path> or installed) and the house Nastaliq; skipped without one.
 * The ink box comes from canvas measureText with the word's own computed font, placed on the text's baseline.
 */
const fs = require('fs');
const path = require('path');

const SA = path.join(__dirname, '..', 'sa');
const FONTS = path.join(__dirname, '..', 'public', 'wq', 'fonts');
const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const css = fs.readFileSync(path.join(SA, 'sa.css'), 'utf8');
const js = ['sa-core.js', 'sa-ui.js'].map((f) => fs.readFileSync(path.join(SA, f), 'utf8'));

// One case per distinct Urdu passage (a variant runs as the task with its own fields) and per distinct Urdu grid.
const lastWord = [];
const grids = [];
fs.readdirSync(FORMS).filter((f) => /^sa\..*\.ur\.json$/.test(f)).sort().forEach((f) => {
  JSON.parse(fs.readFileSync(path.join(FORMS, f), 'utf8')).tasks.forEach((t) => {
    if (t.lang !== 'ur' || t.response !== 'record') return;
    // One at a time ends on the cell reached: no last-word screen.
    if (t.present !== 'one_at_a_time') [t].concat(t.variants || []).forEach((v) => {
      const task = { ...t, ...v, id: t.id, variants: undefined, practice: [], depends_on: undefined };
      const words = (task.items || []).filter((w) => w && (w.label != null || w.target != null));
      if (!words.length) return;
      const key = t.id + ':' + words.map((w) => w.label != null ? w.label : w.target).join(' ');
      if (!lastWord.some((c) => c.key === key)) lastWord.push({ key, name: t.id + (v === t ? '' : '/' + v.id), task });
    });
    if (Array.isArray(t.grid) && t.grid.length && !(t.items || []).length) {
      const key = t.id + ':' + t.grid.join(' ');
      if (!grids.some((c) => c.key === key)) grids.push({ key, name: t.id, task: { ...t, practice: [], depends_on: undefined } });
    }
  });
});

test('the served Urdu forms have last-word passages (every rotated variant) and grids to check', () => {
  expect(lastWord.some((c) => /select2024/.test(c.name))).toBe(true);
  expect(lastWord.some((c) => /جہلم/.test(c.key))).toBe(true);
  expect(lastWord.length).toBeGreaterThanOrEqual(4);
  expect(lastWord.every((c) => c.task.present !== 'one_at_a_time')).toBe(true);
  expect(grids.length).toBeGreaterThanOrEqual(2);
});

let chromium = null;
try { ({ chromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const maybe = chromium ? describe : describe.skip;

maybe('every Urdu word tile, at phone width, holds its word', () => {
  let browser;
  beforeAll(async () => {
    browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {});
  });
  afterAll(async () => { if (browser) await browser.close(); });

  // kind 'coach' / 'child': the last-word screen after the reading; kind 'grid': the read-aloud grid while it runs.
  const page = (c, kind, printed) => `<!doctype html><html lang="ur"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head><body style="margin:0"><main id="m" class="sae"></main>
<script>${js[0]}</script><script>${js[1]}</script>
<script>
  var battery = { battery_id: 'b', tasks: [${JSON.stringify(c.task)}] };
  var runner = SAE.core.createRunner({ battery: battery, onEvent: function () {} });
  var el = document.getElementById('m');
  var view = SAE.ui.mount(el, { runner: runner, battery: battery, lang: 'ur', mode: 'proctored', coach_last_word: ${kind === 'coach'},
    passage_punct: ${printed}, lastWordHint: function () { return null; }, speak: function () { return Promise.resolve(); } });
  var go = el.querySelector('.sae-foot button'); if (go) go.click();
  runner.start(); runner.instructionDone(); runner.begin();
  ${kind === 'grid' ? '' : 'runner.done();'}
  view.render();
</script></body></html>`;

  const measure = (sel) => document.fonts.ready.then(() => {
    const tiles = Array.from(document.querySelectorAll(sel));
    return Promise.all(tiles.map((b) => {
      const ink = b.querySelector('.sae-ink') || b;
      const fc = getComputedStyle(ink); // the ink's own font (fitCells may shrink it)
      const text = b.textContent;
      return document.fonts.load(fc.font, text).then(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))).then(() => {
        const fc2 = getComputedStyle(ink);
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = fc2.font; ctx.direction = 'ltr'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const m = ctx.measureText(text);
        const range = document.createRange(); range.selectNodeContents(ink);
        const t = range.getBoundingClientRect();
        const lines = new Set(Array.from(range.getClientRects()).map((x) => Math.round(x.top))).size;
        const base = t.top + m.fontBoundingBoxAscent;
        const r = b.getBoundingClientRect();
        const bw = parseFloat(getComputedStyle(b).borderTopWidth) || 0;
        return {
          text, lines, size: fc2.fontSize, nastaliq: document.fonts.check(fc2.font, text),
          ink: { top: base - m.actualBoundingBoxAscent, bottom: base + m.actualBoundingBoxDescent, left: t.left - m.actualBoundingBoxLeft, right: t.left + m.actualBoundingBoxRight },
          tile: { top: r.top + bw, bottom: r.bottom - bw, left: r.left + bw, right: r.right - bw },
        };
      });
    })).then((all) => ({ tiles: all, sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
  });

  const run = async (vp, html, sel) => {
    const ctx = await browser.newContext({ viewport: vp });
    const p = await ctx.newPage();
    await p.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(FONTS, path.basename(u.pathname)), contentType: 'font/woff2' });
      if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
      return route.fulfill({ status: 404, body: '' });
    });
    await p.goto('http://sa.test/');
    const r = await p.evaluate(measure, sel);
    await ctx.close();
    return r;
  };
  const spills = (r) => r.tiles.filter((x) => !x.nastaliq || x.lines !== 1 || x.ink.top < x.tile.top || x.ink.bottom > x.tile.bottom
    || x.ink.left < x.tile.left || x.ink.right > x.tile.right).map((x) => x.text);

  for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    for (const kind of ['coach', 'child']) {
      for (const printed of [true, false]) {
        test.each(lastWord.map((c) => [c.name, c]))(`${vp.width}x${vp.height} last word (${kind}, ${printed ? 'printed' : 'plain'}) %s: every word is inside its tile`, async (_n, c) => {
          const r = await run(vp, page(c, kind, printed), '.sae-lastword .sae-passage .sae-word');
          if (process.env.SA_FIT_DEBUG) process.stdout.write(`LW ${vp.width} ${kind} ${JSON.stringify(r.tiles.filter((x) => spills({ tiles: [x] }).length))}\n`);
          expect(r.tiles.length).toBeGreaterThanOrEqual(4);
          expect(spills(r)).toEqual([]);
          expect(new Set(r.tiles.map((x) => x.size)).size).toBe(1); // a passage word keeps the passage's size
          expect(r.sw).toBeLessThanOrEqual(r.vw);
        });
      }
    }
    test.each(grids.map((c) => [c.name, c]))(`${vp.width}x${vp.height} grid %s: every cell holds its word`, async (_n, c) => {
      const r = await run(vp, page(c, 'grid', false), '.sae-grid .sae-cell');
      if (process.env.SA_FIT_DEBUG) process.stdout.write(`GRID ${vp.width} ${JSON.stringify(r.tiles.filter((x) => spills({ tiles: [x] }).length))}\n`);
      expect(r.tiles).toHaveLength(c.task.grid.length);
      expect(spills(r)).toEqual([]);
      const px = r.tiles.map((x) => parseFloat(x.size)); // a grid reads as one size: no word shrunk far below the rest (15%)
      expect(Math.min(...px) / Math.max(...px)).toBeGreaterThanOrEqual(0.85);
      expect(r.sw).toBeLessThanOrEqual(r.vw);
    });
  }
});
