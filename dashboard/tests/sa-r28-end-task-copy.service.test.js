'use strict';
require('./fixtures/binds-loopback');
/**
 * Round 28 (sa_r28_end_task_copy; the engine reads battery.ui.r28_end_task_copy): the coach's hold menu (press and
 * hold, on every coach-led screen, inside the coach page's frame too) offers "End this task", which ends the test
 * (runner.coachEnd()). Its Urdu read «یہ حصہ ختم کریں», the very words of the portal's "End this section" button, which
 * only skips the rest of one section, so an Urdu coach could not tell the two apart. ON, the hold menu's Urdu reads
 * «یہ کام ختم کریں» ("End this task"). OFF (absent): today's words. English is "End this task" either way. The portal's
 * own End this section is not touched.
 *
 *   the switch      app_settings sa_r28_end_task_copy, JSON true only (any other value, no row or a failed read: OFF)
 *   the battery     ON adds battery.ui.r28_end_task_copy = true; OFF the served battery is as before (no ui key)
 *   the menu        sa-ui.js sCoachMenu picks the label by the flag
 */
const express = require('express');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const KEY = 'sa_r28_end_task_copy';
const FLAG = 'r28_end_task_copy';
const UR_TODAY = 'یہ حصہ ختم کریں'; // the portal's End this section says the same
const UR_TASK = 'یہ کام ختم کریں';
const EN = 'End this task';
const cp = (s) => Array.from(s).length; // WhatsApp-style caps count code points

describe('sa_r28_end_task_copy: the battery switch (sa-battery-switches.js)', () => {
  const plain = { battery_id: 'b', tasks: [{ id: 'ur.letters', items: [] }] };
  test('named, and ON puts battery.ui.r28_end_task_copy', () => {
    expect(SWITCHES.r28EndTaskCopy).toBe(KEY);
    expect(applySwitches(plain, { r28EndTaskCopy: true }).ui).toEqual({ [FLAG]: true });
  });
  test('OFF (false or absent): the battery as before, no ui key', () => {
    expect(applySwitches(plain, { r28EndTaskCopy: false })).toEqual(plain);
    expect('ui' in applySwitches(plain, {})).toBe(false);
  });
});

describe('sa_r28_end_task_copy: the engine route reads it from app_settings, JSON true only', () => {
  const NAME = 'sa.coach.G3.A.ur.json';
  let rows;
  let fail;
  beforeEach(() => {
    rows = {};
    fail = false;
    jest.resetModules();
    jest.doMock('../config/supabase', () => ({
      from: (table) => {
        const q = { _eq: null };
        q.select = () => q;
        q.eq = (_col, val) => { q._eq = val; return q; };
        q.maybeSingle = async () => {
          if (table !== 'app_settings') return { data: null, error: null };
          if (fail && q._eq === KEY) return { data: null, error: { message: 'down' } };
          return { data: q._eq in rows ? { value: rows[q._eq] } : null, error: null };
        };
        return q;
      },
    }));
  });
  afterEach(() => { jest.dontMock('../config/supabase'); });
  async function served() {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const off = () => false;
    const app = express();
    // only this switch is left to the router's own reader (the default, app_settings)
    app.use(createSaEngineRouter({ on: () => true, switchHold: off, practiceAllMaths: off, passageRotation: off, voiceV2: off }));
    const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/${NAME}`);
      return r.json();
    } finally { srv.close(); }
  }
  test('the row holds JSON true: the served battery carries ui.r28_end_task_copy', async () => {
    rows[KEY] = true;
    const b = await served();
    expect(b.ui && b.ui[FLAG]).toBe(true);
  });
  for (const [what, v] of [['the string "true"', 'true'], ['1', 1], ['{ enabled: true }', { enabled: true }], ['false', false]]) {
    test(`the row holds ${what}: OFF (no flag)`, async () => {
      rows[KEY] = v;
      const b = await served();
      expect(b.ui && FLAG in b.ui).toBeFalsy();
    });
  }
  test('no row, or a failed read: OFF (no flag)', async () => {
    expect(((await served()).ui || {})[FLAG]).toBeUndefined();
    fail = true;
    rows[KEY] = true;
    expect(((await served()).ui || {})[FLAG]).toBeUndefined();
  });
});

maybe('sa_r28_end_task_copy: the coach hold menu\'s End this task (sa-ui.js sCoachMenu)', () => {
  let dom;
  const keep = {};
  const views = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } });
    for (const k of Object.keys(keep)) global[k] = keep[k];
    dom.window.close();
  });

  const items = (n, p) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i + 1}`, target: 'b', options: ['b', 'p'] }));
  const TAP = { id: 'ur.letters', mode: 'tap', title: 'Letters', coach_text: 'Tap the letter you hear.', practice: [], items: items(3, 'i') };
  /** A coach-led (proctored, RDF manual) run, its hold menu opened; returns the menu's End this task button. */
  function endButton(lang, on) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = Object.assign({ battery_id: 'b', tasks: [TAP] }, on ? { ui: { [FLAG]: true } } : {});
    const events = [];
    const runner = core.createRunner({ battery, onEvent: (e) => events.push(e), mic: () => 'ok', manual: true });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang, mode: 'proctored', manual: true, speak: () => Promise.resolve() });
    views.push(view);
    runner.start();
    view.render();
    el.querySelector('.sae-hold').dispatchEvent(new dom.window.Event('pointerdown'));
    jest.advanceTimersByTime(5000);
    const menu = el.querySelector('.sae-coach-menu');
    expect(menu).not.toBeNull();
    const b = menu.querySelector('.sae-danger');
    expect(b).not.toBeNull();
    return { b, runner, el, events };
  }

  test('ON, Urdu: the hold menu reads «یہ کام ختم کریں», not the portal\'s End this section words', () => {
    const { b } = endButton('ur', true);
    expect(b.textContent).toBe(UR_TASK);
    expect(b.textContent).not.toBe(UR_TODAY);
  });
  test('OFF (no flag), Urdu: today\'s words', () => {
    const { b } = endButton('ur', false);
    expect(b.textContent).toBe(UR_TODAY);
  });
  for (const on of [true, false]) {
    test(`${on ? 'ON' : 'OFF'}, English: "End this task"`, () => {
      expect(endButton('en', on).b.textContent).toBe(EN);
    });
  }
  test('ON: the button still ends the task (runner.coachEnd), and the menu closes', () => {
    const { b, el, events } = endButton('ur', true);
    expect(events.some((e) => e.type === 'coach_unlock')).toBe(false);
    b.click();
    expect(el.querySelector('.sae-coach-menu')).toBeNull();
    expect(events.filter((e) => e.type === 'coach_unlock').map((e) => e.task_id)).toEqual(['ur.letters']);
  });
  test('every label the button can carry fits a button (20 code points or fewer)', () => {
    for (const s of [UR_TASK, UR_TODAY, EN]) expect(cp(s)).toBeLessThanOrEqual(20);
    expect(cp(UR_TASK)).toBe(15);
  });
});
