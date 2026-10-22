'use strict';
/**
 * The tap tiles (dashboard/sa/sa-ui.js tiles() + sa.css .sae-opt): on a phone, every Urdu letter or word on a text
 * tile (familiar words, invented words, letters, first sounds) sits inside its tile, on one line. Nastaliq ink (the tail of «پ», «غ», the top of «ک»)
 * reaches well past the font's line box, so the tile must be sized for the ink, not the line. English tiles keep
 * today's size.
 * Needs a real browser (playwright-core, PWCORE=<path> or installed) and the house Nastaliq; skipped without one.
 * The ink box comes from canvas measureText with the tile's own computed font, placed on the text's baseline.
 */
const fs = require('fs');
const path = require('path');

const SA = path.join(__dirname, '..', 'sa');
const FONTS = path.join(__dirname, '..', 'public', 'wq', 'fonts');
const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const css = fs.readFileSync(path.join(SA, 'sa.css'), 'utf8');
const TASKS = ['ur.words', 'ur.nonwords', 'ur.letters', 'ur.initial_sound'];

// One case per distinct set of options: the item's own run screen, four tiles.
const cases = [];
fs.readdirSync(FORMS).filter((f) => /^sa\.coach\..*\.ur\.json$/.test(f)).forEach((f) => {
  JSON.parse(fs.readFileSync(path.join(FORMS, f), 'utf8')).tasks.forEach((t) => {
    if (TASKS.indexOf(t.id) < 0 || t.response !== 'tap') return;
    (t.practice || []).concat(t.items || []).forEach((it) => {
      const key = t.id + ':' + (it.options || []).join('|');
      if (!cases.some((c) => c.key === key)) cases.push({ key, task: t, item: it });
    });
  });
});

test('the Urdu word tasks of the coach forms have tiles to check', () => {
  expect(cases.length).toBeGreaterThanOrEqual(150);
  expect(cases.some((c) => (c.item.options || []).indexOf('باغ') >= 0)).toBe(true);
});

test('English tiles keep today\'s size', () => {
  expect(css).toMatch(/\n\.sae-opt\{[^}]*font-size:44px;font-weight:800;line-height:1\.2;/);
  expect(css).toMatch(/\n\.sae-opts\.is-many \.sae-opt\{min-height:72px;font-size:32px\}/);
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

  // The task as the form has it, with the item under test as its only item and no practice: the run screen.
  const page = (c) => {
    const task = { ...c.task, practice: [], items: [c.item] };
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
  runner.start(); runner.instructionDone(); runner.begin(); view.render();
</script></body></html>`;
  };

  const measure = () => document.fonts.ready.then(() => {
    const opts = Array.from(document.querySelectorAll('.sae-opts .sae-opt'));
    return Promise.all(opts.map((b) => {
      const cs = getComputedStyle(b);
      const fc = getComputedStyle(b.querySelector('.sae-ink') || b); // the ink's own font (fitCells may shrink it)
      const text = b.textContent;
      return document.fonts.load(fc.font, text).then(() => {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = fc.font; ctx.direction = 'ltr'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const m = ctx.measureText(text);
        const range = document.createRange(); range.selectNodeContents(b.querySelector('.sae-ink') || b);
        const t = range.getBoundingClientRect();
        const lines = new Set(Array.from(range.getClientRects()).map((x) => Math.round(x.top))).size;
        const base = t.top + m.fontBoundingBoxAscent;
        const r = b.getBoundingClientRect();
        const bw = parseFloat(cs.borderTopWidth) || 0;
        return {
          text, lines, nastaliq: document.fonts.check(fc.font, text),
          ink: { top: base - m.actualBoundingBoxAscent, bottom: base + m.actualBoundingBoxDescent, left: t.left - m.actualBoundingBoxLeft, right: t.left + m.actualBoundingBoxRight },
          tile: { top: r.top + bw, bottom: r.bottom - bw, left: r.left + bw, right: r.right - bw },
        };
      });
    })).then((tiles) => ({ tiles, sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
  });

  test('control: an English letter tile and word tile keep 44px bold at 360x640', async () => {
    const en = JSON.parse(fs.readFileSync(path.join(FORMS, 'sa.coach.G3.A.en.json'), 'utf8')).tasks;
    for (const id of ['en.letters', 'en.words']) {
      const t = en.find((x) => x.id === id && x.response === 'tap');
      const html = page({ task: t, item: t.items[0] }).replace('<html lang="ur">', '<html lang="en">').replace("lang: 'ur'", "lang: 'en'");
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
      const p = await ctx.newPage();
      await p.setContent(html);
      const fs2 = await p.evaluate(() => Array.from(document.querySelectorAll('.sae-opts .sae-opt')).map((b) => { const c = getComputedStyle(b); return [c.fontSize, c.fontWeight, c.lineHeight]; }));
      await ctx.close();
      expect(fs2.length).toBeGreaterThanOrEqual(4);
      fs2.forEach((x) => expect(x).toEqual(['44px', '800', '52.8px']));
    }
  });

  for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    test.each(cases.map((c) => [c.task.id, c.item.options.join(' '), c]))(`${vp.width}x${vp.height} %s «%s»: every word is inside its tile`, async (_id, _o, c) => {
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
      if (process.env.SA_FIT_DEBUG) process.stdout.write(`FIT ${vp.width} ${JSON.stringify(r)}\n`);
      expect(r.tiles).toHaveLength(c.item.options.length);
      const out = r.tiles.filter((x) => !x.nastaliq || x.lines !== 1 || x.ink.top < x.tile.top || x.ink.bottom > x.tile.bottom
        || x.ink.left < x.tile.left || x.ink.right > x.tile.right).map((x) => x.text);
      expect(out).toEqual([]);
      expect(r.sw).toBeLessThanOrEqual(r.vw);
    });
  }
});
