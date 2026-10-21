'use strict';
/**
 * RULING W3-19: the printed Urdu passage (sa_passage_punct / the W3 forms, dashboard/sa/sa.css .sae-passage.is-printed)
 * keeps the official page's line pitch, about 2.45 × the font size, so Nastaliq lines do not collide; English stays
 * at 1.6. The child may scroll.
 * Needs a real browser (playwright-core, PWCORE=<path> or installed) and the house Nastaliq; skipped without one.
 * The pitch is measured on the laid-out words: the gap between consecutive line tops, in units of the font size.
 */
const fs = require('fs');
const path = require('path');

const SA = path.join(__dirname, '..', 'sa');
const FONTS = path.join(__dirname, '..', 'public', 'wq', 'fonts');
const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const css = fs.readFileSync(path.join(SA, 'sa.css'), 'utf8');
const form = (lang) => JSON.parse(fs.readFileSync(path.join(FORMS, `sa.coach.G3.A.${lang}.json`), 'utf8'));

// Every served variant of the W3 passage, as the page draws it once a variant is drawn (sa-page rotate()).
const passages = (lang) => {
  const t = form(lang).tasks.find((x) => x.id === `${lang}.story_w3`);
  return (t.variants && t.variants.length ? t.variants : [{ id: 'own', passage: t.passage, items: t.items, stop: t.stop }])
    .map((v) => ({ id: v.id, task: { ...t, variants: undefined, passage: v.passage, items: v.items, stop: v.stop || t.stop } }));
};

test('the Urdu W3 passage has two variants to check', () => {
  expect(passages('ur').map((p) => p.id)).toEqual(expect.arrayContaining(['rwp2026', 'select2024']));
});

let chromium = null;
try { ({ chromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const maybe = chromium ? describe : describe.skip;

maybe('the printed passage keeps its line pitch', () => {
  let browser;
  beforeAll(async () => {
    browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {});
  });
  afterAll(async () => { if (browser) await browser.close(); });

  const page = (task, lang) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head><body style="margin:0"><main id="m" class="sae"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  var battery = { battery_id: 'b', tasks: [${JSON.stringify({ ...task, depends_on: undefined })}] };
  var runner = SAE.core.createRunner({ battery: battery, onEvent: function () {} });
  var el = document.getElementById('m');
  var view = SAE.ui.mount(el, { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', passage_punct: true, speak: function () { return Promise.resolve(); } });
  var go = el.querySelector('.sae-foot button'); if (go) go.click();
  runner.start(); runner.instructionDone(); runner.begin(); view.render();
</script></body></html>`;

  const measure = () => document.fonts.ready.then(() => {
    const box = document.querySelector('.sae-passage.is-printed');
    if (!box) return { has: false };
    const fsz = parseFloat(getComputedStyle(box).fontSize);
    const tops = [...new Set(Array.from(box.querySelectorAll('.sae-word')).map((w) => Math.round(w.getBoundingClientRect().top)))].sort((a, b) => a - b);
    const gaps = tops.slice(1).map((t, i) => t - tops[i]);
    return { has: true, fsz, lines: tops.length, minPitch: Math.min(...gaps) / fsz, sw: document.documentElement.scrollWidth, vw: window.innerWidth };
  });

  async function run(task, lang, vp) {
    const ctx = await browser.newContext({ viewport: vp });
    const p = await ctx.newPage();
    await p.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(FONTS, path.basename(u.pathname)), contentType: 'font/woff2' });
      if (u.pathname === '/') return route.fulfill({ body: page(task, lang), contentType: 'text/html; charset=utf-8' });
      return route.fulfill({ status: 404, body: '' });
    });
    await p.goto('http://sa.test/');
    const r = await p.evaluate(measure);
    await ctx.close();
    return r;
  }

  for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    test.each(passages('ur').map((x) => [x.id, x]))(`UR ${vp.width}x${vp.height} %s: every line is at least 2.3 × the font size below the last`, async (_id, x) => {
      const r = await run(x.task, 'ur', vp);
      expect(r.has).toBe(true);
      expect(r.lines).toBeGreaterThanOrEqual(6);
      expect(r.minPitch).toBeGreaterThanOrEqual(2.3);
      expect(r.sw).toBeLessThanOrEqual(r.vw);
    });
  }

  test('control: the English passage keeps its 1.6 pitch at 390x844', async () => {
    const x = passages('en')[0];
    const r = await run(x.task, 'en', { width: 390, height: 844 });
    expect(r.has).toBe(true);
    expect(r.minPitch).toBeCloseTo(1.6, 1);
  });
});
