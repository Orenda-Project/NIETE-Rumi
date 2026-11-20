'use strict';
/**
 * Round 28, O-115 (switch sa_r28_mic_unknown → battery.ui.r28_mic_unknown): in coach mode a phone with no stored mic
 * check is not a phone with no mic. A test opened in a second browser (another phone's link, Chrome instead of
 * WhatsApp's browser, cleared storage) skipped every recorded task with a working microphone. Now the first recorded
 * task shows the coach's mic card: try it, hear it back. A pass needs the probe's level above the floor AND the
 * coach's "heard"; a phone with no analyser passes on "heard" alone (unmeasured). Only the coach's "go on without",
 * on the card or stored by the pre-flight with a measured level, skips. A failed game check no longer removes the
 * coach's pre-flight pass. OFF: today, byte for byte.
 */
const mic = require('../sa/sa-mic');
const core = require('../sa/sa-core');
const { start } = require('../sa/sa-engine');

function memStore(init = {}) {
  const m = { ...init };
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, m };
}

describe('the switch', () => {
  test('sa_r28_mic_unknown: named, and ON puts battery.ui.r28_mic_unknown; OFF adds nothing', () => {
    const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');
    expect(SWITCHES.r28MicUnknown).toBe('sa_r28_mic_unknown');
    const plain = { battery_id: 'b', tasks: [{ id: 'x', items: [] }] };
    expect(applySwitches(plain, { r28MicUnknown: true }).ui).toEqual({ r28_mic_unknown: true });
    expect(applySwitches(plain, { r28MicUnknown: false })).toEqual(plain);
  });
});

describe('sa-mic', () => {
  test('M2: a failed check keeps the coach pre-flight pass (r28)', () => {
    const s = memStore({ 'sa:mic_ok': JSON.stringify({ mic_ok: true, mic_rms: 0.2, at: 1 }) });
    mic.remember(false, 0, s, { r28: true });
    expect(mic.state(s)).toBe('ok');
  });
  test('OFF-identity: without r28 a failed check still clears a JSON pass, as today', () => {
    const s = memStore({ 'sa:mic_ok': JSON.stringify({ mic_ok: true, mic_rms: 0.2, at: 1 }) });
    mic.remember(false, 0, s);
    expect(mic.state(s)).toBe('unknown');
  });
  test('strict: a stored "no" counts only with a measured level', () => {
    const noLevel = memStore({ 'sa:mic_ok': JSON.stringify({ mic_ok: false, mic_rms: null, at: 1 }) });
    const level = memStore({ 'sa:mic_ok': JSON.stringify({ mic_ok: false, mic_rms: 0.004, at: 1 }) });
    expect(mic.state(noLevel, { strict: true })).toBe('unknown');
    expect(mic.state(level, { strict: true })).toBe('no');
    expect(mic.state(noLevel)).toBe('no'); // today
  });
  test('a probe whose microphone cannot open says denied, unmeasured', async () => {
    const r = await mic.probe(10, { getUserMedia: () => Promise.reject(new Error('NotAllowedError')) });
    expect(r).toMatchObject({ ok: false, denied: true, measured: false });
  });
});

const REC = { id: 'ur.letter_names5', mode: 'record', time_limit_s: 60, items: [{ id: 'ur.letter_names5.1', show: 'ا', target: 'ا' }] };
const engines = [];
afterEach(() => { while (engines.length) engines.pop().destroy(); });

async function boot({ on, stored = null, mode = 'proctored' }) {
  const s = memStore(stored ? { 'sa:mic_ok': stored } : {});
  const fakeMic = {
    state: (_, o) => mic.state(s, o),
    remember: (ok, rms, _, o) => mic.remember(ok, rms, s, o),
    probe: async () => ({ ok: true, rms: 0.1, peak: 0.2, measured: true, url: null }),
    level: () => () => {},
  };
  const events = [];
  const store = await require('../sa/sa-store').open({ idb: null });
  const e = await start({ mount: {}, battery: { battery_id: 'b-mic', tasks: [REC, Object.assign({}, REC, { id: 'ur.oral2' })], ui: on ? { r28_mic_unknown: true } : {} }, mode, lang: 'ur', embed: true, session_id: 's-mic', audio_check: false, warmup: false, onEvent: (x) => events.push(x) }, {
    core, store: { open: async () => store }, ui: { mount: () => ({}) },
    voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) },
    sync: null, mic: fakeMic,
    win: { location: { origin: 'https://p.test' }, addEventListener() {}, removeEventListener() {} },
  });
  engines.push(e);
  e.runner.start();
  return { e, r: e.runner, s, events };
}
const stopOf = (r) => (r.results().find((x) => x.task_id === REC.id) || {}).stop_reason || null;

describe('M9: one level per browser, the newest check\'s (sa:mic_rms)', () => {
  const sink = require('../sa/sink-coach');
  const rec = require('../sa/sa-rec');
  // the device fields one batch carries (sink-coach.js), read from this store
  async function deviceOf(s) {
    let body = null;
    const f = async (u, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ ackedTo: 1 }) }; };
    await sink.create({ fetch: f, localStorage: s, window: null }).putBatch({ session_id: 'x', seq_from: 1, seq_to: 1, events: [], results: [] });
    return body.device;
  }
  test('A1: a silent card go-on-without, then a pre-flight pass at 0.31 (its write clears the key): one level, 0.31', async () => {
    const s = memStore();
    mic.remember(false, 0.0056, s, { r28: true });
    // the pre-flight's write with oneLevel (portal visitStore.saveMic): the JSON, and the engine's key removed
    s.setItem('sa:mic_ok', JSON.stringify({ mic_ok: true, mic_rms: 0.31, at: 2, how: 'auto' }));
    s.removeItem('sa:mic_rms');
    expect((await deviceOf(s)).mic_rms).toBe(0.31);
    expect(rec.thresholdFor(0.05, s)).toBe(rec.thresholdFor(0.05, memStore({ 'sa:mic_ok': JSON.stringify({ mic_ok: true, mic_rms: 0.31 }) })));
  });
  test('A2: a measured card pass at 0.25, then an unmeasured pre-flight pass: no level on the batch (absent, never 0)', async () => {
    const s = memStore();
    mic.remember(true, 0.25, s, { r28: true });
    s.setItem('sa:mic_ok', JSON.stringify({ mic_ok: true, mic_rms: null, at: 2, how: 'unmeasured' }));
    const d = await deviceOf(s); // the key is still there (no oneLevel write here): sink-coach must not fall back to it
    expect(d.mic_ok).toBe(true);
    expect('mic_rms' in d).toBe(false);
  });
  test('A3: a silent check, then an unmeasured card pass: the stale level is removed', async () => {
    const s = memStore();
    mic.remember(false, 0.0056, s, { r28: true });
    mic.remember(true, null, s, { r28: true });
    expect(s.getItem('sa:mic_rms')).toBeNull();
    const d = await deviceOf(s);
    expect(d.mic_ok).toBe(true);
    expect('mic_rms' in d).toBe(false);
  });
  test("psych: a no-analyser pre-flight pass reaches the batch as {mic_ok: true} with no mic_rms key, not 0", async () => {
    const d = await deviceOf(memStore({ 'sa:mic_ok': JSON.stringify({ mic_ok: true, mic_rms: null, at: 1, how: 'unmeasured' }) }));
    expect(d.mic_ok).toBe(true);
    expect('mic_rms' in d).toBe(false);
  });
  test("OFF-identity: the game's own check keeps sa:mic_rms as today (a check with no level leaves it)", () => {
    const s = memStore({ 'sa:mic_rms': '0.08' });
    mic.remember(true, null, s);
    expect(s.getItem('sa:mic_rms')).toBe('0.08');
    expect(rec.thresholdFor(0.05, s)).toBe(rec.thresholdFor(0.05, memStore({ 'sa:mic_rms': '0.08' })));
  });
});

describe('the engine, coach mode', () => {
  test('M1: ON, a working mic and no stored flag: the coach card, not mic_unavailable', async () => {
    const x = await boot({ on: true });
    expect(x.r.view().phase).toBe('mic_check');
    expect(stopOf(x.r)).toBeNull();
    x.r.micChecked(true, 0.2, 'auto');
    expect(x.r.view().phase).not.toBe('task_end');
    expect(mic.state(x.s)).toBe('ok'); // the pass is kept for this browser
  });
  test('OFF-identity: no stored flag is mic_unavailable at once, as today', async () => {
    const x = await boot({ on: false });
    expect(stopOf(x.r)).toBe('mic_unavailable');
  });
  test("ON, the pre-flight's stored go-on-without (a measured level): skips as today, no card", async () => {
    const x = await boot({ on: true, stored: JSON.stringify({ mic_ok: false, mic_rms: 0.004, at: 1 }) });
    expect(stopOf(x.r)).toBe('mic_unavailable');
  });
  test("ON, the card's go-on-without: this task and the next skip; the card shows once", async () => {
    const x = await boot({ on: true });
    x.r.micChecked(false, 0.004, 'auto');
    expect(stopOf(x.r)).toBe('mic_unavailable');
    x.r.next();
    expect(x.r.view().phase).not.toBe('mic_check');
    expect((x.r.results().find((y) => y.task_id === 'ur.oral2') || {}).stop_reason).toBe('mic_unavailable');
  });
  test('ON, the mic_check event carries how', async () => {
    const x = await boot({ on: true });
    x.r.micChecked(true, null, 'unmeasured');
    await new Promise((r) => setTimeout(r, 20));
    expect((x.events.find((y) => y.type === 'mic_check') || {}).value).toEqual({ ok: true, rms: null, how: 'unmeasured' });
    expect(mic.state(x.s)).toBe('ok');
  });
});

// The card on a real DOM (jsdom, as sa-ui-screens.service.test.js: a portal dev dependency; skipped where it is missing).
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('the coach mic card (sa-ui)', () => {
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
  });
  afterEach(() => { views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });
  const flush = () => new Promise((r) => setTimeout(r, 20));
  const rec = { id: 'story', mode: 'record', time_limit_s: 60, passage: { text: 'a b' }, items: [{ id: 'w', target: 'a', line: 1 }] };

  async function mount(probeResult, { manual = true, on = true, speak = () => Promise.resolve() } = {}) {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const calls = [];
    const battery = { battery_id: 'b', tasks: [rec], ui: on ? { r28_mic_unknown: true } : {} };
    const runner = c.createRunner({ battery, onEvent: (e) => calls.push(e), mic: () => 'unknown', mic_check: true });
    const el = document.getElementById('m');
    const probes = [];
    const view = ui.mount(el, { runner, battery, lang: 'en', mode: 'proctored', manual, speak,
      micProbe: () => { probes.push(1); return Promise.resolve(probeResult); } });
    views.push(view);
    runner.start();
    // the coach's hand-over screen comes first in coach mode
    for (let i = 0; i < 4 && (i === 0 || el.getAttribute('data-phase') !== 'mic_check'); i++) {
      await flush();
      const btn = el.querySelector('.sae-primary') || el.querySelector('button');
      if (btn) btn.click();
    }
    await flush();
    return { runner, el, calls, probes };
  }
  const buttons = (el) => [...el.querySelectorAll('button')];
  const byText = (el, t) => buttons(el).find((b) => b.textContent === t || b.textContent.replace(/^\S+ /, '') === t);
  const micEv = (calls) => (calls.find((e) => e.type === 'mic_check') || {}).value;

  test('a level above the floor: "I heard it" passes, with the peak and how auto', async () => {
    const x = await mount({ ok: true, rms: 0.1, peak: 0.2, measured: true, url: null });
    expect(x.el.getAttribute('data-phase')).toBe('mic_check');
    expect(byText(x.el, 'Go on without it')).toBeUndefined(); // only after one try
    byText(x.el, 'Try the microphone').click();
    await flush(); await flush();
    expect(x.probes).toHaveLength(1);
    byText(x.el, 'I heard it').click();
    await flush();
    expect(micEv(x.calls)).toEqual({ ok: true, rms: 0.2, how: 'auto' });
    expect(x.runner.view().phase).toBe('instruction');
  });

  test('M3/M8: at or under the floor there is no "I heard it"; the card says no sound, Try again, then go on without', async () => {
    const x = await mount({ ok: false, rms: 0.005, peak: 0.0078, measured: true, url: null });
    byText(x.el, 'Try the microphone').click();
    await flush(); await flush();
    expect(byText(x.el, 'I heard it')).toBeUndefined();
    expect(x.el.textContent).toContain('No sound came through.');
    expect(byText(x.el, 'Try again')).toBeDefined();
    byText(x.el, 'Go on without it').click();
    await flush();
    expect(micEv(x.calls)).toEqual({ ok: false, rms: 0.0078, how: 'auto' });
    expect((x.runner.results().find((r) => r.task_id === 'story') || {}).stop_reason).toBe('mic_unavailable');
  });

  test('no analyser: "I heard it" alone passes, stored unmeasured (rms null)', async () => {
    const x = await mount({ ok: true, rms: 0, peak: 0, measured: false, url: null });
    byText(x.el, 'Try the microphone').click();
    await flush(); await flush();
    byText(x.el, 'I heard it').click();
    await flush();
    expect(micEv(x.calls)).toEqual({ ok: true, rms: null, how: 'unmeasured' });
  });

  test('a denied microphone: the fix line (not "no sound"), no "I heard it", and go on without logs how denied', async () => {
    const x = await mount({ ok: false, rms: 0, peak: 0, measured: false, denied: true, url: null });
    byText(x.el, 'Try the microphone').click();
    await flush(); await flush();
    expect(byText(x.el, 'I heard it')).toBeUndefined();
    expect(x.el.textContent).toContain('The microphone is blocked or missing.');
    expect(x.el.textContent).toContain('Then tap Try again.');
    expect(x.el.textContent).not.toContain('No sound came through.');
    byText(x.el, 'Go on without it').click();
    await flush();
    expect(micEv(x.calls)).toEqual({ ok: false, rms: null, how: 'denied' });
  });

  test('a denied microphone: the fix line takes the heading\'s place, so it and Try again come first (360-wide fold)', async () => {
    const x = await mount({ ok: false, rms: 0, peak: 0, measured: false, denied: true, url: null });
    byText(x.el, 'Try the microphone').click();
    await flush(); await flush();
    const body = x.el.querySelector('.sae-miccheck.is-ask .sae-body');
    expect(body.querySelector('.sae-h1')).toBeNull();
    expect(x.el.textContent).not.toContain('Microphone check: tap the button');
    expect(body.firstElementChild.classList.contains('sae-micu-denied')).toBe(true);
    expect(body.querySelector('.sae-pics .is-again').textContent).toBe('Try again');
    // the card's own layout hook (one full-width Try again, tighter gaps): only on the blocked-mic ask screen
    expect(x.el.querySelector('.sae-miccheck.is-coach.is-ask').classList.contains('is-denied')).toBe(true);
    // a quiet microphone is not a blocked one: its heading stays
    const q = await mount({ ok: false, rms: 0.005, peak: 0.0078, measured: true, url: null });
    byText(q.el, 'Try the microphone').click();
    await flush(); await flush();
    expect(q.el.querySelector('.sae-miccheck.is-ask .sae-h1').textContent).toBe('No sound came through.');
    expect(q.el.querySelector('.sae-micu-denied')).toBeNull();
    expect(q.el.querySelector('.sae-miccheck.is-denied')).toBeNull();
  });

  test('the voice never contradicts the screen: below the floor, no "did you hear it?" is spoken; above it, it is', async () => {
    for (const [pr, asked] of [[{ ok: false, rms: 0.005, peak: 0.0078, measured: true, url: null }, false], [{ ok: true, rms: 0.1, peak: 0.2, measured: true, url: null }, true]]) {
      const said = [];
      const x = await mount(pr, { manual: false, speak: (l) => { said.push(l); return Promise.resolve(); } }); // RDF auto: Jugnu speaks
      byText(x.el, 'Try the microphone').click();
      await flush(); await flush(); await flush();
      const ask = said.some((l) => JSON.stringify(l).includes('Did you hear yourself?'));
      expect(ask).toBe(asked);
      views.splice(0).forEach((v) => v.destroy());
    }
  });

  test('the try button carries the mic glyph; the Urdu card says «دوبارہ کوشش کریں»', async () => {
    const x = await mount({ ok: false, rms: 0.005, peak: 0.0078, measured: true, url: null });
    expect(x.el.querySelector('.sae-micu-try .sae-micu-glyph')).not.toBeNull();
    const { COPY } = require('../sa/sa-ui');
    if (COPY) expect(COPY.ur.micu_again).toBe('دوبارہ کوشش کریں');
  });

  test('RDF auto: go on without needs the coach to press and hold; a tap does nothing', async () => {
    const x = await mount({ ok: false, rms: 0.005, peak: 0.0078, measured: true, url: null }, { manual: false });
    byText(x.el, 'Try the microphone').click();
    await flush(); await flush();
    const w = byText(x.el, 'Go on without it');
    w.click();
    await flush();
    expect(micEv(x.calls)).toBeUndefined();
    expect(w.className).toContain('is-hold');
  });

  test("OFF-identity: proctored mode with the game check on draws the game's screen, not the card", async () => {
    const x = await mount({ ok: true, rms: 0.04, url: null }, { on: false });
    expect(byText(x.el, 'Try the microphone')).toBeUndefined();
  });
});
