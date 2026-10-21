'use strict';
/**
 * One item at a time (dashboard/sa/sa-ui.js oneCell + sa.css .sae-onecell): on a phone, every Urdu letter and word
 * of the W3 coach forms sits inside its card. Nastaliq ink (the tail of «ل», «ی», «ے») reaches well past the font's
 * line box, so the card must be sized for the ink, not the line, and a word stays on one line.
 * Needs a real browser (playwright-core, PWCORE=<path> or installed) and the house Nastaliq; skipped without one.
 * The ink box comes from canvas measureText with the cell's own computed font, placed on the text's baseline.
 */
const fs = require('fs');
const path = require('path');

const SA = path.join(__dirname, '..', 'sa');
const FONTS = path.join(__dirname, '..', 'public', 'wq', 'fonts');
const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const css = fs.readFileSync(path.join(SA, 'sa.css'), 'utf8');

const cases = [];
fs.readdirSync(FORMS).filter((f) => /^sa\.coach\..*\.ur\.json$/.test(f)).forEach((f) => {
  const form = JSON.parse(fs.readFileSync(path.join(FORMS, f), 'utf8'));
  form.tasks.forEach((t) => {
    if (t.present !== 'one_at_a_time' || t.lang !== 'ur') return;
    const shows = (t.items || []).concat(t.practice || []).map((x) => String(x.show != null ? x.show : x.target));
    Array.from(new Set(shows)).forEach((s) => {
      if (!cases.some((c) => c.task.id === t.id && c.show === s)) cases.push({ form: f, task: t, show: s });
    });
  });
});

test('the Urdu one-at-a-time tasks of the W3 forms have letters and words to check', () => {
  expect(cases.some((c) => c.show === 'ل')).toBe(true);
  expect(cases.length).toBeGreaterThanOrEqual(15);
});

let chromium = null;
try { ({ chromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const maybe = chromium ? describe : describe.skip;

maybe('every Urdu letter and word, one at a time, sits inside its card', () => {
  let browser;
  beforeAll(async () => {
    browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {});
  });
  afterAll(async () => { if (browser) await browser.close(); });

  // The task as the form has it, with the item under test as its only (example) practice item.
  const page = (c) => {
    const p0 = (c.task.practice || [])[0] || {};
    const task = { ...c.task, practice: [{ ...p0, id: 'p', show: c.show, target: c.show, role: 'example' }] };
    return `<!doctype html><html lang="ur"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head><body style="margin:0"><main id="m" class="sae"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  var battery = { battery_id: 'b', tasks: [${JSON.stringify(task)}] };
  var runner = SAE.core.createRunner({ battery: battery, onEvent: function () {} });
  var el = document.getElementById('m');
  var view = SAE.ui.mount(el, { runner: runner, battery: battery, lang: 'ur', mode: 'proctored', speak: function () { return Promise.resolve(); } });
  var go = el.querySelector('.sae-foot button'); if (go) go.click();
  runner.start(); runner.instructionDone(); view.render();
</script></body></html>`;
  };

  const measure = () => document.fonts.ready.then(() => {
    const cell = document.querySelector('.sae-onecell');
    if (!cell) return { has: false };
    const cs = getComputedStyle(cell);
    const text = cell.textContent;
    return document.fonts.load(cs.font, text).then(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = cs.font; ctx.direction = 'ltr'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const m = ctx.measureText(text);
      const range = document.createRange(); range.selectNodeContents(cell);
      const t = range.getBoundingClientRect();
      const lines = new Set(Array.from(range.getClientRects()).map((x) => Math.round(x.top))).size;
      const base = t.top + m.fontBoundingBoxAscent;
      const b = cell.getBoundingClientRect();
      const bw = parseFloat(cs.borderTopWidth) || 0;
      return {
        has: true, font: cs.font, lines, nastaliq: document.fonts.check(cs.font, text),
        ink: { top: base - m.actualBoundingBoxAscent, bottom: base + m.actualBoundingBoxDescent, left: t.left - m.actualBoundingBoxLeft, right: t.left + m.actualBoundingBoxRight },
        card: { top: b.top + bw, bottom: b.bottom - bw, left: b.left + bw, right: b.right - bw },
        sw: document.documentElement.scrollWidth, vw: window.innerWidth,
      };
    });
  });

  for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    test.each(cases.map((c) => [c.task.id, c.show, c]))(`${vp.width}x${vp.height} %s «%s»: the ink box is inside the card`, async (_id, _s, c) => {
      const ctx = await browser.newContext({ viewport: vp });
      const p = await ctx.newPage();
      await p.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(FONTS, path.basename(u.pathname)), contentType: 'font/woff2' });
        if (u.pathname === '/') return route.fulfill({ body: page(c), contentType: 'text/html; charset=utf-8' });
        return route.fulfill({ status: 404, body: '' });
      });
      await p.goto('http://sa.test/');
      const r = await p.evaluate(measure);
      await ctx.close();
      if (process.env.SA_FIT_DEBUG) process.stdout.write(`FIT ${vp.width} ${c.show} ${JSON.stringify(r)}\n`);
      expect(r.has).toBe(true);
      expect(r.nastaliq).toBe(true);
      expect(r.lines).toBe(1);
      expect(r.ink.top).toBeGreaterThanOrEqual(r.card.top);
      expect(r.ink.bottom).toBeLessThanOrEqual(r.card.bottom);
      expect(r.ink.left).toBeGreaterThanOrEqual(r.card.left);
      expect(r.ink.right).toBeLessThanOrEqual(r.card.right);
      expect(r.sw).toBeLessThanOrEqual(r.vw);
    });
  }
});
