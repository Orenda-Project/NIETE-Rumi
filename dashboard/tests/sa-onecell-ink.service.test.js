'use strict';
/**
 * One item at a time, as the child sees it while the clock runs (dashboard/sa/sa-ui.js sRunCell + sa.css .sae-onecell):
 * every Urdu letter and word any served form can show one at a time (the W3 one-at-a-time tasks, and the read-aloud
 * grids the sa_one_at_a_time switch shows cell by cell) is drawn whole, centred, inside its card, and the card is not
 * under the sticky Next button, at 360x640 and 390x844, RDF auto and RDF manual.
 * Measured on the pixels, not on the layout: the page is screenshotted with only the item's ink visible, and every
 * dark pixel must be inside the card's border.
 * Needs a real browser (playwright-core, PWCORE=<path> or installed) and the house Nastaliq; skipped without one.
 */
const fs = require('fs');
const path = require('path');

const SA = path.join(__dirname, '..', 'sa');
const FONTS = path.join(__dirname, '..', 'public', 'wq', 'fonts');
const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const css = fs.readFileSync(path.join(SA, 'sa.css'), 'utf8');
const js = ['sa-core.js', 'sa-ui.js'].map((f) => fs.readFileSync(path.join(SA, f), 'utf8'));

// Every distinct Urdu cell, with one task that shows it (the first form that has it).
const cases = [];
fs.readdirSync(FORMS).filter((f) => /^sa\..*\.ur\.json$/.test(f)).sort().forEach((f) => {
  const form = JSON.parse(fs.readFileSync(path.join(FORMS, f), 'utf8'));
  form.tasks.forEach((t) => {
    if (t.lang !== 'ur' || t.passage) return;
    const one = t.present === 'one_at_a_time';
    const cells = Array.isArray(t.grid) && t.grid.length ? t.grid
      : one ? (t.items || []).map((x) => (x.show != null ? x.show : x.target)) : [];
    cells.map(String).forEach((s) => {
      if (!/[؀-ۿ]/.test(s) || cases.some((c) => c.show === s)) return;
      cases.push({ form: f, show: s, task: { ...t, response: 'record', grid: [s], items: one ? [{ ...(t.items || [])[0], show: s, target: s }] : [], practice: [], depends_on: undefined } });
    });
  });
});

test('the served Urdu forms have letters and long words to check, from the grids too', () => {
  expect(cases.some((c) => c.show === 'ث')).toBe(true);
  expect(cases.some((c) => c.show === 'دروازہ')).toBe(true);
  expect(cases.some((c) => !c.task.present)).toBe(true);
  expect(cases.length).toBeGreaterThanOrEqual(60);
});

let chromium = null;
try { ({ chromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const maybe = chromium ? describe : describe.skip;

maybe('every Urdu cell on the timed one-at-a-time screen is whole, centred and above the Next button', () => {
  let browser;
  beforeAll(async () => {
    browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {});
  });
  afterAll(async () => { if (browser) await browser.close(); });

  const page = (c, manual) => `<!doctype html><html lang="ur"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head><body style="margin:0"><main id="m" class="sae"></main>
<script>${js[0]}</script><script>${js[1]}</script>
<script>
  var battery = { battery_id: 'b', tasks: [${JSON.stringify(c.task)}] };
  var runner = SAE.core.createRunner({ battery: battery, one_at_a_time: true, manual: ${manual}, onEvent: function () {} });
  var el = document.getElementById('m');
  var view = SAE.ui.mount(el, { runner: runner, battery: battery, lang: 'ur', mode: 'proctored', manual: ${manual}, speak: function () { return Promise.resolve(); } });
  var go = el.querySelector('.sae-foot button'); if (go) go.click();
  runner.start(); runner.instructionDone(); if (runner.view().phase !== 'running') runner.begin(); view.render();
</script></body></html>`;

  // The screen as laid out: the card, its border, the sticky foot's top.
  const layout = () => document.fonts.ready.then(() => {
    const cell = document.querySelector('.sae-run-cell .sae-onecell');
    if (!cell) return { has: false, phase: document.querySelector('.sae-screen') && document.querySelector('.sae-screen').className };
    const cs = getComputedStyle(cell);
    return document.fonts.load(cs.font, cell.textContent).then(() => {
      const b = cell.getBoundingClientRect();
      const bw = parseFloat(cs.borderTopWidth) || 0;
      const foot = document.querySelector('.sae-foot');
      const style = document.createElement('style');
      // Only the item's ink is left to see: everything else is hidden, the card's own paint is cleared.
      style.textContent = 'body *{visibility:hidden!important}body,.sae{background:#fff!important}'
        + '.sae-onecell,.sae-onecell *{visibility:visible!important;color:#000!important;background:#fff!important;border-color:#fff!important}';
      document.head.appendChild(style);
      return {
        has: true, nastaliq: document.fonts.check(cs.font, cell.textContent),
        card: { top: b.top + bw, bottom: b.bottom - bw, left: b.left + bw, right: b.right - bw },
        footTop: foot ? foot.getBoundingClientRect().top : Infinity,
        sw: document.documentElement.scrollWidth, vw: window.innerWidth, dpr: window.devicePixelRatio,
      };
    });
  });

  // The dark pixels' box in CSS px (the screenshot is decoded on a canvas in the page).
  const inkBox = (png) => new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      const s = img.width / window.innerWidth;
      let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity, n = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const k = (y * img.width + x) * 4;
          if (d[k] + d[k + 1] + d[k + 2] > 384) continue;
          n++; if (y < top) top = y; if (y > bottom) bottom = y; if (x < left) left = x; if (x > right) right = x;
        }
      }
      ok({ n, top: top / s, bottom: (bottom + 1) / s, left: left / s, right: (right + 1) / s, h: img.height / s });
    };
    img.src = 'data:image/png;base64,' + png;
  });

  for (const manual of [false, true]) {
    for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
      test.each(cases.map((c) => [c.task.id, c.show, c]))(`${manual ? 'manual' : 'auto'} ${vp.width}x${vp.height} %s «%s»`, async (_id, _s, c) => {
        const ctx = await browser.newContext({ viewport: vp });
        const p = await ctx.newPage();
        await p.route('**/*', (route) => {
          const u = new URL(route.request().url());
          if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(FONTS, path.basename(u.pathname)), contentType: 'font/woff2' });
          if (u.pathname === '/') return route.fulfill({ body: page(c, manual), contentType: 'text/html; charset=utf-8' });
          return route.fulfill({ status: 404, body: '' });
        });
        await p.goto('http://sa.test/');
        const r = await p.evaluate(layout);
        let ink = null;
        if (r.has) ink = await p.evaluate(inkBox, (await p.screenshot({ fullPage: true })).toString('base64'));
        await ctx.close();
        if (process.env.SA_INK_DEBUG) process.stdout.write(`INK ${manual} ${vp.width} ${c.show} ${JSON.stringify({ r, ink })}\n`);
        expect(r.has).toBe(true);
        expect(r.nastaliq).toBe(true);
        expect(ink.n).toBeGreaterThan(50);
        // whole: every dark pixel inside the card's border (1 px for anti-aliasing)
        expect(ink.top).toBeGreaterThanOrEqual(r.card.top - 1);
        expect(ink.bottom).toBeLessThanOrEqual(r.card.bottom + 1);
        expect(ink.left).toBeGreaterThanOrEqual(r.card.left - 1);
        expect(ink.right).toBeLessThanOrEqual(r.card.right + 1);
        // centred: the ink's middle within 8% of the card's width (and height) of the card's middle
        const cw = r.card.right - r.card.left, chh = r.card.bottom - r.card.top;
        expect(Math.abs((ink.left + ink.right) / 2 - (r.card.left + r.card.right) / 2)).toBeLessThanOrEqual(cw * 0.08);
        expect(Math.abs((ink.top + ink.bottom) / 2 - (r.card.top + r.card.bottom) / 2)).toBeLessThanOrEqual(chh * 0.08);
        // the whole card above the sticky Next button, on the first screen (no scrolling to see the item)
        expect(r.card.bottom).toBeLessThanOrEqual(Math.min(r.footTop, vp.height));
        expect(r.sw).toBeLessThanOrEqual(r.vw);
      });
    }
  }
});
