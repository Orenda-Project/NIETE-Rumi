'use strict';
/**
 * Round 6 (switch sa_ur_fit, default OFF): every Urdu word on the self-administered battery's screens (the child's and
 * the coach's) is whole, inside its box, clear of pictures and of the foot, and drawn in Nastaliq at ≥ 16 px (13 px for
 * the coach's own words) on lines ≥ 2em, at 320x568, 360x640, 390x844 and 130 %.
 *
 * The switch reaches the battery as ui.ur_fit, the engine passes ur_fit to the page, and the page puts .is-ur-fit on
 * its mount (dashboard/sa/sa.css "Round 6"). OFF: no ui key, no class, the screens as before.
 *
 * The walk (tests/support/sa-ur-walk.js) drives every phase of the coach forms' RDF auto and RDF manual in a real
 * browser with the house Nastaliq and tests each Urdu word's own glyphs by pixel. Needs playwright-core (PWCORE=<path>
 * or installed) and Chromium; skipped without them. The full report: scripts/sa-ur-fit-walk.js.
 */
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybeDom = JSDOM ? describe : describe.skip;

const TAP = { battery_id: 'b', tasks: [{ id: 'ur.words', subtask: 'familiar_word_reading', response: 'tap', lang: 'ur', time_limit_s: 60,
  items: [{ id: 'w1', target: 'باغ', options: ['باغ', 'دوست', 'کتاب', 'گھر'] }] }] };

describe('the switch reaches the battery as ui.ur_fit, and the engine passes it to the page', () => {
  test('named sa_ur_fit; ON adds ui.ur_fit; OFF no ui key', () => {
    const b = { battery_id: 'b', tasks: [{ id: 't' }] };
    expect(SWITCHES.urFit).toBe('sa_ur_fit');
    expect(applySwitches(b, { urFit: true, rdfW3Forms: true }).ui).toEqual({ ur_fit: true });
    expect(JSON.stringify(applySwitches(b, { rdfW3Forms: true }))).toBe(JSON.stringify(b));
  });

  test('engine: battery.ui.ur_fit → the page\'s ur_fit; absent → false', async () => {
    const core = require('../sa/sa-core');
    const storeMod = require('../sa/sa-store');
    const { start } = require('../sa/sa-engine');
    const got = [];
    for (const ui of [{ ur_fit: true }, undefined]) {
      const store = await storeMod.open({ idb: null });
      await start({ mount: {}, battery: Object.assign({}, TAP, ui ? { ui } : {}), mode: 'proctored', lang: 'ur', session_id: 's-fit-' + got.length, audio_check: false, warmup: false }, {
        core, store: { open: async () => store }, ui: { mount: (el, o) => { got.push(o.ur_fit); return {}; } },
        voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) }, rec: { create: () => null }, micState: () => 'ok',
      });
    }
    expect(got).toEqual([true, false]);
  });
});

describe('the route reads the switch', () => {
  const express = require('express');
  const { createSaEngineRouter } = require('../routes/sa-engine.routes');
  async function serve(on) {
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, rdfW3Forms: () => true, urFit: () => on, env: {} }));
    const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    return { srv, base: `http://127.0.0.1:${srv.address().port}` };
  }
  test('ON: the served battery carries ui.ur_fit; OFF: it does not', async () => {
    for (const on of [true, false]) {
      const x = await serve(on);
      try {
        const b = await (await fetch(`${x.base}/sa/batteries/sa.coach.G3.A.ur.json`)).json();
        expect([on, !!(b.ui && b.ui.ur_fit)]).toEqual([on, on]);
      } finally { x.srv.close(); }
    }
  });
});

maybeDom('the page marks its mount (sa-ui)', () => {
  let dom; const keep = {}; const views = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });
  function mount(uiOpts) {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const runner = c.createRunner({ battery: TAP, now: () => 0, mic: () => 'ok' });
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery: TAP, lang: 'ur', mode: 'proctored', speak: () => Promise.resolve() }, uiOpts));
    views.push(view);
    return el;
  }
  test('ON: .is-ur-fit on the mount', () => { expect(mount({ ur_fit: true }).classList.contains('is-ur-fit')).toBe(true); });
  test('OFF: no .is-ur-fit', () => { expect(mount({}).classList.contains('is-ur-fit')).toBe(false); });
});

// ---- the screens themselves, in a real browser -------------------------------------------------------------------
let chromium = null;
try { ({ chromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const maybe = chromium ? describe : describe.skip;

maybe('ON: every Urdu word on every screen of the visit fits (real browser, Nastaliq, pixels)', () => {
  const W = require('./support/sa-ur-walk');
  let browser;
  beforeAll(async () => {
    browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {});
  });
  afterAll(async () => { if (browser) await browser.close(); });
  const fmt = (r) => r.flatMap((s) => s.fails.map((f) => `${s.state.task || '-'} ${s.state.shown} ${f.kind} «${f.word || f.text || ''}» ${f.sel || ''} ${f.by || f.holder || f.clip || f.other_sel || ''}`));

  // Grades 1, 3 and 5, both runs of the visit, the smallest phone and 130 %.
  const cases = [];
  W.scenarios({ grades: [1, 3, 5] }).forEach((sc) => ['320x568', '360x640@130'].forEach((v) => cases.push([sc.id, v, sc])));
  test.each(cases)('%s at %s: no Urdu word clipped, outside its box, covered or colliding; ≥ 16 px; lines ≥ 2em', async (_id, vpName, sc) => {
    const vp = W.VIEWPORTS.find((v) => v.name === vpName);
    const r = await W.walk(browser, sc, vp, { urFit: true });
    expect(r.length).toBeGreaterThan(60); // the whole visit was walked, to the end screen
    expect(r.some((s) => s.state.shown === 'battery_end')).toBe(true);
    expect(fmt(r)).toEqual([]);
  }, 180000);

  test('OFF: the same walk still finds the Urdu failures the switch fixes (the measure sees them)', async () => {
    const sc = W.scenarios({ grades: [3] })[0];
    const r = await W.walk(browser, sc, W.VIEWPORTS.find((v) => v.name === '360x640'), {});
    const kinds = new Set(r.flatMap((s) => s.fails.map((f) => f.kind)));
    expect([...kinds].sort()).toEqual(expect.arrayContaining(['outside', 'tight']));
  }, 180000);
});
