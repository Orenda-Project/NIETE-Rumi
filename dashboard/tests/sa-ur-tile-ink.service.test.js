'use strict';
/**
 * The Urdu text tap tiles (dashboard/sa/sa-ui.js tiles() + fitCells, sa.css .sae-opt): every letter or word on a tile
 * (familiar words, invented words, letters, first sounds) is drawn inside its tile and in its middle, at 360x640 and
 * 390x844. Nastaliq ink sinks below its line box (ب پ م ن ں), so a tile centred on the line box shows its letter low.
 * Measured on the pixels: the page is screenshotted with only the tiles' ink visible; every dark pixel must be inside
 * a tile, and each tile's ink box centred within 8% of the tile.
 * Needs a real browser (playwright-core, PWCORE=<path> or installed) and the house Nastaliq; skipped without one.
 */
const fs = require('fs');
const path = require('path');

const SA = path.join(__dirname, '..', 'sa');
const FONTS = path.join(__dirname, '..', 'public', 'wq', 'fonts');
const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const css = fs.readFileSync(path.join(SA, 'sa.css'), 'utf8');
const js = ['sa-core.js', 'sa-ui.js'].map((f) => fs.readFileSync(path.join(SA, f), 'utf8'));
const TASKS = ['ur.words', 'ur.nonwords', 'ur.letters', 'ur.initial_sound'];

// One case per distinct set of options, from every served Urdu form: the item's own run screen.
const cases = [];
fs.readdirSync(FORMS).filter((f) => /^sa\..*\.ur\.json$/.test(f)).sort().forEach((f) => {
  JSON.parse(fs.readFileSync(path.join(FORMS, f), 'utf8')).tasks.forEach((t) => {
    if (TASKS.indexOf(t.id) < 0) return;
    (t.items || []).concat(t.practice || []).forEach((it) => {
      const o = it.options || it.choices || [];
      const key = t.id + ':' + o.join('|');
      if (o.length && !cases.some((c) => c.key === key)) cases.push({ key, task: { ...t, response: 'tap', practice: [], items: [it], depends_on: undefined }, n: o.length });
    });
  });
});

test('the Urdu tap tasks of the served forms have tiles to check', () => {
  expect(cases.length).toBeGreaterThanOrEqual(150);
  expect(cases.some((c) => /(^|\|)پ(\||$)/.test(c.key))).toBe(true);
});

let chromium = null;
try { ({ chromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const maybe = chromium ? describe : describe.skip;

maybe('every Urdu text tile holds its letter or word in its middle', () => {
  let browser;
  beforeAll(async () => {
    browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {});
  });
  afterAll(async () => { if (browser) await browser.close(); });

  const page = (c) => `<!doctype html><html lang="ur"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head><body style="margin:0"><main id="m" class="sae"></main>
<script>${js[0]}</script><script>${js[1]}</script>
<script>
  var battery = { battery_id: 'b', tasks: [${JSON.stringify(c.task)}] };
  var runner = SAE.core.createRunner({ battery: battery, onEvent: function () {} });
  var el = document.getElementById('m');
  var view = SAE.ui.mount(el, { runner: runner, battery: battery, lang: 'ur', mode: 'proctored', speak: function () { return Promise.resolve(); } });
  var go = el.querySelector('.sae-foot button'); if (go) go.click();
  runner.start(); runner.instructionDone(); runner.begin(); view.render();
</script></body></html>`;

  // The tiles' inner boxes once the font is in, then only their ink left to see.
  const layout = () => document.fonts.ready.then(() => {
    const opts = Array.from(document.querySelectorAll('.sae-opts .sae-opt'));
    return Promise.all(opts.map((o) => document.fonts.load(getComputedStyle(o).font, o.textContent))).then(() => {
      // fitCells re-places the ink once the font has loaded: wait a frame for it.
      return new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    }).then(() => {
      const tiles = opts.map((o) => {
        const r = o.getBoundingClientRect();
        const bw = parseFloat(getComputedStyle(o).borderTopWidth) || 0;
        return { text: o.textContent, top: r.top + bw, bottom: r.bottom - bw, left: r.left + bw, right: r.right - bw };
      });
      const style = document.createElement('style');
      style.textContent = 'body *{visibility:hidden!important}body,.sae{background:#fff!important}'
        + '.sae-opt,.sae-opt *{visibility:visible!important;color:#000!important;background:#fff!important;border-color:#fff!important;box-shadow:none!important}';
      document.head.appendChild(style);
      return { tiles, nastaliq: opts.every((o) => document.fonts.check(getComputedStyle(o).font, o.textContent)), sw: document.documentElement.scrollWidth, vw: window.innerWidth };
    });
  });

  // Each dark pixel goes to the tile it is in (or counts as outside all of them); each tile's ink box.
  const inkBoxes = ([png, tiles]) => new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      const s = img.width / window.innerWidth;
      const boxes = tiles.map(() => ({ n: 0, top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity }));
      let outside = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const k = (y * img.width + x) * 4;
          if (d[k] + d[k + 1] + d[k + 2] > 384) continue;
          const cx = x / s, cy = y / s;
          const i = tiles.findIndex((t) => cx >= t.left - 1 && cx <= t.right + 1 && cy >= t.top - 1 && cy <= t.bottom + 1);
          if (i < 0) { outside++; continue; }
          const b = boxes[i];
          b.n++; b.top = Math.min(b.top, cy); b.bottom = Math.max(b.bottom, cy + 1 / s); b.left = Math.min(b.left, cx); b.right = Math.max(b.right, cx + 1 / s);
        }
      }
      ok({ outside, boxes });
    };
    img.src = 'data:image/png;base64,' + png;
  });

  for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    test.each(cases.map((c) => [c.key, c]))(`${vp.width}x${vp.height} %s`, async (_k, c) => {
      const ctx = await browser.newContext({ viewport: vp });
      const p = await ctx.newPage();
      await p.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(FONTS, path.basename(u.pathname)), contentType: 'font/woff2' });
        if (u.pathname === '/') return route.fulfill({ body: page(c), contentType: 'text/html; charset=utf-8' });
        return route.fulfill({ status: 404, body: '' });
      });
      await p.goto('http://sa.test/');
      const r = await p.evaluate(layout);
      const ink = await p.evaluate(inkBoxes, [(await p.screenshot({ fullPage: true })).toString('base64'), r.tiles]);
      await ctx.close();
      if (process.env.SA_INK_DEBUG) process.stdout.write(`TILE ${vp.width} ${c.key} ${JSON.stringify({ r, ink })}\n`);
      expect(r.tiles).toHaveLength(c.n);
      expect(r.nastaliq).toBe(true);
      expect(ink.outside).toBe(0);
      const off = r.tiles.map((t, i) => {
        const b = ink.boxes[i];
        const dy = Math.abs((b.top + b.bottom) / 2 - (t.top + t.bottom) / 2) / (t.bottom - t.top);
        const dx = Math.abs((b.left + b.right) / 2 - (t.left + t.right) / 2) / (t.right - t.left);
        return b.n > 20 && dy <= 0.08 && dx <= 0.08 ? null : `${t.text} dy=${dy.toFixed(2)} dx=${dx.toFixed(2)} n=${b.n}`;
      }).filter(Boolean);
      expect(off).toEqual([]);
      expect(r.sw).toBeLessThanOrEqual(r.vw);
    });
  }
});
