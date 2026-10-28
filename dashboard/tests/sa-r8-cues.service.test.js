'use strict';
/**
 * Round 8, the child's screens (dashboard/sa/sa-ui.js), each behind its battery switch (battery.ui.r8_<flag>):
 *   items 25/26 (r8_nudges)  every child item screen shows a small, quiet cue of how it is answered: a mic with a live
 *                             level bar on a speaking screen (SAE.mic.level; the recorder's stream when one is open), a
 *                             tapping hand on a tapping screen. The level loop stops when the screen is left.
 * OFF: the screens as before (no cue, no class, no level loop).
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));

maybe('round 8 items 25/26: the speak / tap cue (r8_nudges)', () => {
  let dom; let views = []; const keep = {};
  beforeEach(() => {
    views = [];
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  /** A fake SAE.mic.level: counts starts and stops, hands the test the callback. */
  function meter() {
    const m = { starts: 0, stops: 0, cb: null };
    m.level = (cb) => { m.starts += 1; m.cb = cb; return () => { m.stops += 1; }; };
    return m;
  }
  const TAP = { id: 'ur.t', mode: 'tap', lang: 'ur', script: {}, items: [{ id: 'ur.t.01', target: 'ب', options: ['ب', 'پ'] }, { id: 'ur.t.02', target: 'پ', options: ['ب', 'پ'] }] };
  const CELLS = { id: 'ur.w', mode: 'record', present: 'one_at_a_time', advance_after_s: 0, time_limit_s: 60, items: [{ id: 'c1', target: 'x', show: 'x' }, { id: 'c2', target: 'y', show: 'y' }] };
  const ORAL = { id: 'ur.c', mode: 'oral', lang: 'ur', script: {}, items: [{ id: 'q1', say: 'کیا؟' }, { id: 'q2', say: 'کون؟' }] };
  const KEYPAD = { id: 'ma.add', mode: 'keypad', script: {}, items: [{ id: 'ma.add.01', target: 5, say: '2 + 3' }] };

  function mount(task, { on = true, lang = 'en', m = meter(), extra = {} } = {}) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = { battery_id: 'b', lines: {}, tasks: [task] };
    if (on) battery.ui = { r8_nudges: true };
    const runner = core.createRunner({ battery, onEvent: () => {}, mic: () => 'ok' });
    runner.start(); runner.instructionDone();
    if (runner.view().phase === 'practice') runner.skipPractice && runner.skipPractice();
    if (runner.view().phase !== 'running') runner.begin();
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery, lang, mode: 'game', micLevel: m.level, speak: () => Promise.resolve() }, extra));
    views.push(view);
    view.render();
    return { el, runner, view, m };
  }

  test('OFF: no cue, no class, no level loop on a speaking screen (today\'s screen)', async () => {
    const { el, m, runner } = mount(CELLS, { on: false });
    expect(runner.view().phase).toBe('running');
    await flush();
    expect(el.querySelector('.sae-r8-cue')).toBeNull();
    expect(el.classList.contains('is-r8-cues')).toBe(false);
    expect(m.starts).toBe(0);
  });

  test('OFF: the tap screen\'s DOM is the same as with the switch absent from ui', () => {
    const a = mount(TAP, { on: false });
    const html = a.el.innerHTML;
    views.splice(0).forEach((v) => v.destroy());
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = { battery_id: 'b', lines: {}, tasks: [TAP], ui: { r8_nudges: false } };
    const runner = core.createRunner({ battery, onEvent: () => {}, mic: () => 'ok' });
    runner.start(); runner.instructionDone(); if (runner.view().phase !== 'running') runner.begin();
    const el = document.getElementById('m');
    views.push(ui.mount(el, { runner, battery, lang: 'en', mode: 'game', speak: () => Promise.resolve() }));
    expect(el.innerHTML).toBe(html);
  });

  test('ON, a tap screen: a hand cue in the top bar, labelled, the picture hidden from readers; no mic opened', () => {
    const { el, m, runner } = mount(TAP);
    expect(runner.view().phase).toBe('running');
    expect(el.classList.contains('is-r8-cues')).toBe(true);
    const cue = el.querySelector('.sae-top .sae-r8-cue');
    expect(cue).not.toBeNull();
    expect(cue.getAttribute('data-cue')).toBe('tap');
    expect(cue.getAttribute('role')).toBe('img');
    expect(cue.getAttribute('aria-label')).toBe('Answer by tapping');
    expect(cue.querySelector('svg')).not.toBeNull();
    expect(cue.querySelector('.sae-r8-ico').getAttribute('aria-hidden')).toBe('true');
    expect(cue.querySelector('.sae-r8-lvl')).toBeNull();
    expect(m.starts).toBe(0);
  });

  test('ON, a typed number is a tapping screen too', () => {
    const { el } = mount(KEYPAD);
    expect(el.querySelector('.sae-r8-cue').getAttribute('data-cue')).toBe('tap');
  });

  test('ON, a read-aloud cell: a mic cue with a level bar driven by SAE.mic.level; one loop per screen', () => {
    const { el, m, view } = mount(CELLS);
    const cue = el.querySelector('.sae-r8-cue');
    expect(cue.getAttribute('data-cue')).toBe('speak');
    expect(cue.getAttribute('aria-label')).toBe('Answer by speaking');
    expect(m.starts).toBe(1);
    const lvl = cue.querySelector('.sae-r8-lvl');
    // no level yet (the mic may be unavailable): the icon alone
    expect(lvl.hidden).toBe(true);
    m.cb(0.5);
    expect(el.querySelector('.sae-r8-lvl').hidden).toBe(false);
    expect(el.querySelector('.sae-r8-lvl-fill').style.height).toBe('50%');
    // a redraw of the same screen keeps the same loop and paints the new bar
    view.render();
    expect(m.starts).toBe(1);
    expect(m.stops).toBe(0);
    expect(el.querySelector('.sae-r8-lvl').hidden).toBe(false);
    m.cb(0.25);
    expect(el.querySelector('.sae-r8-lvl-fill').style.height).toBe('25%');
  });

  test('ON: leaving the speaking screen stops its level loop; the next one starts its own; destroy stops it', () => {
    const { el, m, runner, view } = mount(CELLS);
    expect(m.starts).toBe(1);
    runner.nextCell('tap');
    view.render();
    expect(m.stops).toBe(1);
    expect(m.starts).toBe(2);
    // a late level from the old loop paints nothing
    const old = m.cb;
    view.destroy();
    expect(m.stops).toBe(2);
    old(0.9);
    expect(el.querySelector('.sae-r8-lvl-fill')).toBeNull();
  });

  test('ON, Urdu, a spoken question: the mic cue with its Urdu label', () => {
    const { el, runner } = mount(ORAL, { lang: 'ur' });
    expect(runner.view().phase).toBe('running');
    const cue = el.querySelector('.sae-r8-cue');
    expect(cue.getAttribute('data-cue')).toBe('speak');
    expect(cue.getAttribute('aria-label')).toBe('بول کر جواب دیں');
  });

  test('ON: no level reader at all → the mic icon without a bar, no error', () => {
    const { el } = mount(CELLS, { extra: { micLevel: null } });
    const cue = el.querySelector('.sae-r8-cue');
    expect(cue.getAttribute('data-cue')).toBe('speak');
    expect(cue.querySelector('.sae-r8-lvl')).toBeNull();
  });

  test('ON: no cue on the instruction screen (not an item screen)', () => {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = { battery_id: 'b', lines: {}, tasks: [TAP], ui: { r8_nudges: true } };
    const runner = core.createRunner({ battery, onEvent: () => {} });
    runner.start();
    const el = document.getElementById('m');
    views.push(ui.mount(el, { runner, battery, lang: 'en', mode: 'game', speak: () => Promise.resolve() }));
    expect(runner.view().phase).toBe('instruction');
    expect(el.querySelector('.sae-r8-cue')).toBeNull();
  });
});

describe('SAE.mic.level reuses an open recorder stream (sa-mic.js)', () => {
  const keepSelf = global.self;
  afterEach(() => { global.self = keepSelf; jest.resetModules(); });
  function fakeRoot(shared) {
    const calls = { gum: 0, trackStops: 0, ctxClosed: 0 };
    const track = () => ({ stop: () => { calls.trackStops += 1; } });
    const own = { getTracks: () => [track()] };
    function AC() {
      this.createMediaStreamSource = (s) => { calls.source = s; return { connect: () => {} }; };
      this.createAnalyser = () => ({ fftSize: 32, getByteTimeDomainData: (b) => b.fill(160) });
      this.close = () => { calls.ctxClosed += 1; };
    }
    const root = {
      navigator: { mediaDevices: { getUserMedia: () => { calls.gum += 1; return Promise.resolve(own); } } },
      AudioContext: AC,
      SAE: shared ? { rec: { stream: () => shared } } : {},
    };
    return { root, calls, own };
  }
  test('a recorder stream is open: no second getUserMedia, and stop() leaves the recorder\'s tracks running', async () => {
    const shared = { getTracks: () => [{ readyState: 'live', stop: () => { throw new Error('must not stop the recorder'); } }] };
    const { root, calls } = fakeRoot(shared);
    global.self = root;
    const mic = require('../sa/sa-mic');
    const levels = [];
    const stop = mic.level((l) => levels.push(l));
    await flush(250);
    expect(calls.gum).toBe(0);
    expect(calls.source).toBe(shared);
    expect(levels.length).toBeGreaterThan(0);
    stop();
    expect(calls.ctxClosed).toBe(1);
  });
  test('no recorder stream: its own getUserMedia, as before, and stop() ends it', async () => {
    const { root, calls } = fakeRoot(null);
    global.self = root;
    const mic = require('../sa/sa-mic');
    const stop = mic.level(() => {});
    await flush(50);
    expect(calls.gum).toBe(1);
    stop();
    expect(calls.trackStops).toBe(1);
  });
  test('an ended recorder stream is not borrowed', async () => {
    const ended = { getTracks: () => [{ readyState: 'ended', stop: () => {} }] };
    const { root, calls } = fakeRoot(ended);
    global.self = root;
    const mic = require('../sa/sa-mic');
    const stop = mic.level(() => {});
    await flush(50);
    expect(calls.gum).toBe(1);
    stop();
  });
});

describe('SAE.rec.stream(): the recorder\'s open stream (sa-rec.js)', () => {
  test('null before ready(), the stream after, null after release()', async () => {
    const rec = require('../sa/sa-rec');
    const s = { getTracks: () => [{ stop: () => {} }] };
    function MR() {}
    MR.isTypeSupported = () => true;
    const r = rec.create({ store: {}, session_id: 's', MediaRecorder: MR, getUserMedia: () => Promise.resolve(s), localStorage: null, taps: false });
    expect(r.stream()).toBeNull();
    expect(rec.stream()).toBeNull();
    await r.ready();
    expect(r.stream()).toBe(s);
    expect(rec.stream()).toBe(s);
    r.release();
    expect(rec.stream()).toBeNull();
  });
});
