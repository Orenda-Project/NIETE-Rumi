'use strict';
/**
 * The sandbox-only "Jump to…" in a Whole battery (dashboard/sa/sa-ui.js + sa.css): the select sits on its own
 * full-width row above the dots, and the dots can never push anything off-screen, however many tasks the session has.
 * The CSS half always runs; the layout half needs a real browser (playwright-core, PWCORE=<path> or installed) and is
 * skipped without one.
 */
const fs = require('fs');
const path = require('path');

const SA = path.join(__dirname, '..', 'sa');
const css = fs.readFileSync(path.join(SA, 'sa.css'), 'utf8');

function rule(sel) {
  const m = css.match(new RegExp(`(^|\\n)${sel.replace(/[.$]/g, '\\$&')}\\{([^}]*)\\}`));
  return m ? m[2] : '';
}

test('CSS: the dots shrink and clip; the jump row is its own full-width row', () => {
  expect(rule('.sae-dots')).toMatch(/min-width:0/);
  expect(rule('.sae-dots')).toMatch(/overflow:hidden/);
  expect(rule('.sae-dots')).toMatch(/flex:1 1 auto/);
  expect(rule('.sae-devjump-row')).toMatch(/flex:0 0 auto/);
  expect(rule('.sae-devjump-row')).toMatch(/width:100%/);
});

let chromium = null;
try { ({ chromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const maybe = chromium ? describe : describe.skip;

maybe('a 33-task battery at 360 px: the select stays on screen', () => {
  let browser;
  beforeAll(async () => {
    browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {});
  });
  afterAll(async () => { if (browser) await browser.close(); });

  const tasks = (n) => Array.from({ length: n }, (_, i) => ({
    id: `en.t${i}`, title: { en: `Task ${i + 1}`, ur: `حصہ ${i + 1}` }, mode: 'tap', items: [{ id: 'i', target: 'a', options: ['a', 'b'] }],
  }));
  const page = (lang, n) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head><body style="margin:0"><main id="m" class="sae"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  var battery = { battery_id: 'b', tasks: ${JSON.stringify(tasks(n))} };
  var runner = SAE.core.createRunner({ battery: battery, onEvent: function () {}, dev_tools: true });
  var el = document.getElementById('m');
  var view = SAE.ui.mount(el, { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', devJump: function () {}, speak: function () { return Promise.resolve(); } });
  var go = el.querySelector('.sae-foot button'); if (go) go.click();
  runner.start(); view.render();
</script></body></html>`;

  for (const [lang, n] of [['ur', 33], ['en', 33], ['ur', 5], ['en', 5]]) {
    test(`${lang.toUpperCase()}, ${n} tasks: the select's rect is inside the 360 px viewport, the page does not scroll sideways`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
      const p = await ctx.newPage();
      await p.setContent(page(lang, n));
      const r = await p.evaluate(() => {
        const s = document.querySelector('select.sae-devjump');
        const b = s && s.getBoundingClientRect();
        return { has: !!s, left: b && b.left, right: b && b.right, sw: document.documentElement.scrollWidth, vw: window.innerWidth };
      });
      await ctx.close();
      expect(r.has).toBe(true);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(r.vw);
      expect(r.sw).toBeLessThanOrEqual(r.vw);
    });
  }
});
