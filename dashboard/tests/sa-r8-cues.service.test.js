'use strict';
/**
 * Round 8, the child's screens (dashboard/sa/sa-ui.js), each behind its battery switch (battery.ui.r8_<flag>):
 *   items 25/26 (r8_nudges)  every child item screen shows a small, quiet cue of how it is answered: a mic with a live
 *                             level bar on a speaking screen (SAE.mic.level; the recorder's stream when one is open), a
 *                             tapping hand on a tapping screen. The level loop stops when the screen is left.
 *   item 32 (r8_highlight)   the instruction's words lit one by one while its v4 clip plays (see below).
 * OFF: the screens as before (no cue, no class, no level loop, no timing fetched).
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

/**
 * Round 8 item 32 (r8_highlight): the instruction's words are lit one by one while its v4 clip plays, from the timing
 * file beside the clip (sa/v4/<lang>/<key>.json, the storybook's shape). The clock is the playing audio element (the
 * voice's speak.audio()). No file, a 404, a word-count mismatch or no audio element: the plain text, quietly.
 */
maybe('round 8 item 32: the instruction lit word by word (r8_highlight)', () => {
  const path = require('path');
  const FIX = { en: require(path.join(__dirname, 'fixtures', 'sa-r8-timing', 'en.json')), ur: require(path.join(__dirname, 'fixtures', 'sa-r8-timing', 'ur.json')) };
  let dom; let views = []; const keep = {};
  beforeEach(() => {
    views = [];
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame', 'fetch']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  /** fetch stub: url → body (an object = 200 JSON; a number = that status). */
  function fetcher(map) {
    const f = jest.fn((url) => {
      const b = map[url];
      if (b == null) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
      if (typeof b === 'number') return Promise.resolve({ ok: false, status: b, json: () => Promise.reject(new Error(String(b))) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(b))) });
    });
    global.fetch = f; dom.window.fetch = f;
    return f;
  }
  /** The voice: speak() plays a fake <audio> (its src under the CDN), speak.audio() is the playing one. */
  function voice({ hook = true } = {}) {
    const v = { cur: null, ends: [], said: [] };
    v.speak = (t, a) => {
      v.said.push(t);
      const clip = (a || (t && t.audio)) || null;
      const key = typeof clip === 'string' ? clip : clip && (clip.en || clip.ur);
      v.cur = key ? { src: 'https://cdn.test/' + key, currentTime: 0, paused: false } : null;
      return new Promise((r) => { v.ends.push(() => { v.cur = null; r(); }); });
    };
    if (hook) v.speak.audio = () => v.cur;
    return v;
  }
  function mount({ lang = 'en', on = true, clip, fix = FIX[lang], hook = true, child } = {}) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const intro = { text: fix.text, audio: { [lang]: clip || fix.audio.url } };
    const battery = { battery_id: 'b', lines: {}, tasks: [{ id: lang + '.t', mode: 'tap', lang, script: { intro_tap: intro }, items: [{ id: lang + '.t.01', target: 'a', options: ['a', 'b'] }] }] };
    if (on) battery.ui = { r8_highlight: true };
    const runner = core.createRunner({ battery, onEvent: () => {} });
    runner.start();
    const vo = voice({ hook });
    const el = document.getElementById('m');
    views.push(ui.mount(el, { runner, battery, lang, mode: 'game', speak: vo.speak, child }));
    expect(runner.view().phase).toBe('instruction');
    return { el, vo };
  }
  const lit = (el) => [...el.querySelectorAll('.sae-r8-w.is-on')].map((s) => s.textContent);
  const frames = (n = 4) => flush(17 * n);

  test('EN: the word the clip is on is lit, and moves with the clock', async () => {
    const f = fetcher({ 'https://cdn.test/sa/v4/en/r8demo02.json': FIX.en });
    const { el, vo } = mount();
    await frames();
    expect(f).toHaveBeenCalledWith('https://cdn.test/sa/v4/en/r8demo02.json', expect.anything());
    expect(el.querySelectorAll('.sae-say .sae-r8-w').length).toBe(5);
    expect(lit(el)).toEqual(['Tap']);
    vo.cur.currentTime = 0.95;
    await frames();
    expect(lit(el)).toEqual(['Jugnu']);
    vo.cur.currentTime = 1.5;
    await frames();
    expect(lit(el)).toEqual(['says.']);
    // the text reads the same, nothing bolder
    expect(el.querySelector('.sae-say').textContent).toBe(FIX.en.text);
    // the clip ends: nothing lit
    vo.ends.shift()();
    await frames();
    expect(lit(el)).toEqual([]);
  });

  test('the highlight changes only when the word changes (no DOM work on a steady clock)', async () => {
    fetcher({ 'https://cdn.test/sa/v4/en/r8demo02.json': FIX.en });
    const { el, vo } = mount();
    await frames();
    vo.cur.currentTime = 0.6;
    await frames();
    let n = 0;
    const mo = new dom.window.MutationObserver((ms) => { n += ms.length; });
    mo.observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
    await frames(6);
    mo.disconnect();
    expect(n).toBe(0);
    expect(lit(el)).toEqual(['letter']);
  });

  test('UR: the Urdu instruction lit word by word', async () => {
    fetcher({ 'https://cdn.test/sa/v4/ur/r8demo01.json': FIX.ur });
    const { el, vo } = mount({ lang: 'ur' });
    await frames();
    vo.cur.currentTime = 0.7;
    await frames();
    expect(lit(el)).toEqual(['جگنو']);
    expect(el.querySelector('.sae-say').textContent).toBe(FIX.ur.text);
  });

  test('the child\'s name in front of the words is not part of the lit text', async () => {
    fetcher({ 'https://cdn.test/sa/v4/en/r8demo02.json': FIX.en });
    const { el } = mount({ child: { first_name: 'Sam' } });
    await frames();
    expect(el.querySelector('.sae-say .sae-name').textContent).toBe('Sam');
    expect(el.querySelectorAll('.sae-say .sae-r8-w').length).toBe(5);
    expect(lit(el)).toEqual(['Tap']);
  });

  test('the timing is fetched once and kept (a replay reuses it)', async () => {
    const f = fetcher({ 'https://cdn.test/sa/v4/en/r8demo02.json': FIX.en });
    const { el, vo } = mount();
    await frames();
    vo.ends.shift()();
    await frames();
    el.querySelector('.sae-replay').click();
    await frames();
    expect(lit(el)).toEqual(['Tap']);
    expect(f).toHaveBeenCalledTimes(1);
  });

  describe('every miss is the plain text, quietly', () => {
    let errs;
    beforeEach(() => { errs = [jest.spyOn(console, 'error').mockImplementation(() => {}), jest.spyOn(console, 'warn').mockImplementation(() => {}), jest.spyOn(console, 'log').mockImplementation(() => {})]; });
    afterEach(() => { errs.forEach((s) => { expect(s).not.toHaveBeenCalled(); s.mockRestore(); }); });
    test('no timing file (404)', async () => {
      const f = fetcher({});
      const { el } = mount();
      await frames();
      expect(f).toHaveBeenCalledTimes(1);
      expect(el.querySelector('.sae-r8-w')).toBeNull();
      expect(el.querySelector('.sae-say').textContent).toBe(FIX.en.text);
    });
    test('a word count that does not match the text on screen', async () => {
      const bad = Object.assign({}, FIX.en, { words: FIX.en.words.slice(0, 4) });
      fetcher({ 'https://cdn.test/sa/v4/en/r8demo02.json': bad });
      const { el } = mount();
      await frames();
      expect(el.querySelector('.sae-r8-w')).toBeNull();
    });
    test('a broken file (not v1, bad times)', async () => {
      fetcher({ 'https://cdn.test/sa/v4/en/r8demo02.json': Object.assign({}, FIX.en, { v: 2 }) });
      const { el } = mount();
      await frames();
      expect(el.querySelector('.sae-r8-w')).toBeNull();
    });
    test('fetch rejects (offline, nothing cached)', async () => {
      const f = jest.fn(() => Promise.reject(new TypeError('offline')));
      global.fetch = f; dom.window.fetch = f;
      const { el } = mount();
      await frames();
      expect(el.querySelector('.sae-r8-w')).toBeNull();
    });
    test('no audio element reachable (the voice has no speak.audio)', async () => {
      const f = fetcher({ 'https://cdn.test/sa/v4/en/r8demo02.json': FIX.en });
      const { el } = mount({ hook: false });
      await frames();
      expect(f).not.toHaveBeenCalled();
      expect(el.querySelector('.sae-r8-w')).toBeNull();
    });
    test('a clip that is not a v4 clip: no timing asked for', async () => {
      const f = fetcher({});
      const { el } = mount({ clip: 'sa/v1/en/abcdef123456.mp3' });
      await frames();
      expect(f).not.toHaveBeenCalled();
      expect(el.querySelector('.sae-r8-w')).toBeNull();
    });
  });

  test('OFF: no fetch, the instruction exactly as today', async () => {
    const f = fetcher({ 'https://cdn.test/sa/v4/en/r8demo02.json': FIX.en });
    const { el } = mount({ on: false });
    await frames();
    expect(f).not.toHaveBeenCalled();
    expect(el.querySelector('.sae-say').innerHTML).toBe(FIX.en.text);
    expect(el.classList.contains('is-r8-hl')).toBe(false);
  });
});
