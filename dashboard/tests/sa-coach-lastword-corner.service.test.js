'use strict';
/**
 * The coach's last-word screen (sa_coach_last_word) with a long passage: the portal's corner hold ("End test (coach)",
 * fixed at the top-start corner, ~56 px tall with its 8 px inset) covered the heading's first word once the page
 * scrolled: the word box (60vh) pushed the screen past the phone's height. The coach's screen now fits the viewport
 * (the word box scrolls inside it), so the page never scrolls and the heading stays below the hold.
 * Needs a real browser (playwright-core); skipped without one.
 */
const fs = require('fs');
const path = require('path');

const SA = path.join(__dirname, '..', 'sa');
const css = fs.readFileSync(path.join(SA, 'sa.css'), 'utf8');
const HOLD_BOTTOM = 56;

let chromium = null;
try { ({ chromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const maybe = chromium ? describe : describe.skip;

maybe('the coach last-word screen at 360x640: the heading clears the corner hold', () => {
  let browser;
  beforeAll(async () => {
    browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {});
  });
  afterAll(async () => { if (browser) await browser.close(); });

  const words = Array.from({ length: 60 }, (_, i) => ({ id: 'w' + (i + 1), target: 'word' + (i + 1), line: 1 + Math.floor(i / 6) }));
  const passage = { battery_id: 'b', tasks: [{ id: 'en.story_w3', subtask: 'oral_reading_fluency', response: 'record', lang: 'en', time_limit_s: 60,
    passage: { text: words.map((w) => w.target).join(' ') }, items: words }] };
  const page = (lang) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head><body style="margin:0">
<div id="hold" style="position:fixed;top:8px;inset-inline-start:8px;width:120px;height:48px;z-index:1001;background:#fff">End test (coach)</div>
<main id="m" class="sae"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  var battery = ${JSON.stringify(passage)};
  var t = 0;
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return t; }, mic: function () { return 'ok'; }, onEvent: function () {} });
  var el = document.getElementById('m');
  var view = SAE.ui.mount(el, { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', coach_last_word: true,
    lastWordHint: function () { return new Promise(function () {}); }, speak: function () { return Promise.resolve(); } });
  runner.start(); runner.instructionDone(); runner.begin(); t = 20000; runner.done(); view.render();
</script></body></html>`;

  for (const lang of ['en', 'ur']) {
    test(`${lang.toUpperCase()}: scrolled to the words, the heading's top is still below the hold`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
      const p = await ctx.newPage();
      await p.setContent(page(lang));
      const r = await p.evaluate(() => {
        window.scrollTo(0, 100000); // the coach scrolls down to the words
        const h = document.querySelector('.sae-lastword.is-coach .sae-h1');
        const box = document.querySelector('.sae-lastword.is-coach .sae-passage');
        const ok = document.querySelector('.sa-lw-confirm');
        return { has: !!h, top: h && h.getBoundingClientRect().top, box: box.getBoundingClientRect().height,
          okBottom: ok.getBoundingClientRect().bottom, vh: window.innerHeight };
      });
      await ctx.close();
      expect(r.has).toBe(true);
      expect(r.top).toBeGreaterThanOrEqual(HOLD_BOTTOM);
      expect(r.box).toBeGreaterThanOrEqual(150); // the words are still there to tap
      expect(r.okBottom).toBeLessThanOrEqual(r.vh); // and Confirm is on screen
    });
  }
});
