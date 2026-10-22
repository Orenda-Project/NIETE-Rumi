'use strict';
/**
 * Round 4: letters and words shown one at a time moved on too fast (3 s from the moment the item showed, whatever the
 * child was doing). Switch sa_cell_pace (default OFF): EGRA's rule is to move on when the child has not responded for
 * 3 s, so the wait counts only silence. A voice heard on the mic (runner.voice(), fed by the recorder's onVoice)
 * starts the 3 s again, and no item moves on by itself before 5 s on screen. Coach-led (RDF manual): never by itself.
 * OFF, the 3 s from show stays, byte for byte.
 */
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const rec = require('../sa/sa-rec');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

function clock() { let t = 0; return { now: () => t, add: (ms) => { t += ms; } }; }
const GRID = ['ر', 'د', 'م', 'ک', 'س'];
function run(opts) {
  const c = clock();
  const battery = { battery_id: 'b', tasks: [{ id: 'ur.letter_names5', subtask: 'letter_name_identification', response: 'record', lang: 'ur',
    time_limit_s: 60, grid: GRID.slice(), items: [] }] };
  const r = core.createRunner(Object.assign({ battery, now: c.now, mic: () => 'ok', one_at_a_time: true }, opts || {}));
  r.start(); r.instructionDone(); r.begin();
  // step(ms): the clock in 100-ms ticks, as the page's animation loop calls tick()
  const step = (ms, each) => { let out = null; for (let x = 0; x < ms; x += 100) { c.add(100); if (each) each(c.now()); const v = r.tick(); if (v) out = v; } return out; };
  return { r, c, step };
}

describe('sa_cell_pace ON (cell_pace)', () => {
  test('a silent child: the letter stays at 3 s and 4.9 s, moves on at 5 s', () => {
    const { r, step } = run({ cell_pace: true });
    step(3000); expect(r.view().cell_index).toBe(0);
    step(1900); expect(r.view().cell_index).toBe(0);
    expect(step(100)).toBe('go_on');
    expect(r.view().cell_index).toBe(1);
  });
  test('a child still trying (voice heard at 2-4.5 s): the letter waits 3 s after the last voice (moves at 7.5 s)', () => {
    const { r, step } = run({ cell_pace: true });
    const voice = (t) => { if (t >= 2000 && t <= 4500) r.voice(); };
    step(7400, voice); expect(r.view().cell_index).toBe(0);
    step(100, voice); expect(r.view().cell_index).toBe(1);
  });
  test('a tap still moves on at once, before the 5 s', () => {
    const { r, step } = run({ cell_pace: true });
    step(800);
    r.nextCell('tap');
    expect(r.view().cell_index).toBe(1);
  });
  test('coach-led (manual): never moves by itself, voice or not', () => {
    const { r, step } = run({ cell_pace: true, manual: true });
    step(30000);
    expect(r.view().cell_index).toBe(0);
  });
  test('voice() outside a cell is a no-op', () => {
    const c = clock();
    const r = core.createRunner({ battery: { battery_id: 'b', tasks: [{ id: 't', subtask: 'letter_name_identification', response: 'record', grid: GRID, items: [] }] }, now: c.now, mic: () => 'ok', cell_pace: true });
    expect(() => r.voice()).not.toThrow();
  });
});

describe('OFF: 3 s from show, unchanged', () => {
  test('moves on at 3 s even while the child speaks', () => {
    const { r, step } = run();
    expect(step(3000, () => r.voice && r.voice())).toBe('go_on');
    expect(r.view().cell_index).toBe(1);
  });
});

describe('the recorder: onVoice(cb) calls cb on every voiced tick until cancelled', () => {
  class FakeMR { static isTypeSupported(t) { return t === 'audio/webm'; } start() {} stop() { if (this.onstop) this.onstop(); } }
  function fakeAudio(ck, level) {
    return class {
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() { return { fftSize: 2048, getByteTimeDomainData(buf) { const a = Math.round(level(ck.t) * 127); for (let i = 0; i < buf.length; i++) buf[i] = 128 + (i % 2 ? a : -a); } }; }
      close() { return Promise.resolve(); }
    };
  }
  test('voice from 2 s to 3 s: cb fires on those ticks only; cancel stops it', async () => {
    const ck = { t: 0 };
    const fns = new Map(); let n = 0;
    const iv = { set: (f) => { fns.set(++n, f); return n; }, clear: (h) => { fns.delete(h); } };
    const s = await storeMod.open({ idb: null });
    const r = rec.create({ store: s, session_id: 'x', MediaRecorder: FakeMR, getUserMedia: async () => ({ getTracks: () => [] }),
      now: () => ck.t, AudioContext: fakeAudio(ck, (t) => (t >= 2000 && t < 3000 ? 0.3 : 0.001)), interval: iv, localStorage: null });
    await r.ready();
    r.start('ur.letter_names5');
    const at = [];
    const cancel = r.onVoice(() => at.push(ck.t));
    const go = (ms) => { for (let x = 0; x < ms; x += 100) { ck.t += 100; [...fns.values()].forEach((f) => f()); } };
    go(5000);
    expect(at.length).toBeGreaterThan(3);
    expect(Math.min(...at)).toBeGreaterThanOrEqual(2000);
    expect(Math.max(...at)).toBeLessThan(3100);
    cancel();
    expect(fns.size).toBe(0);
  });
});

describe('the switch reaches the battery as ui.cell_pace', () => {
  const b = { battery_id: 'b', tasks: [{ id: 't' }] };
  test('named sa_cell_pace; ON adds ui.cell_pace; OFF no ui key', () => {
    expect(SWITCHES.cellPace).toBe('sa_cell_pace');
    expect(applySwitches(b, { cellPace: true, rdfW3Forms: true }).ui).toEqual({ cell_pace: true });
    expect(JSON.stringify(applySwitches(b, { rdfW3Forms: true }))).toBe(JSON.stringify(b));
  });
});

describe('the engine wires the recorder\'s voice to the runner (ui.cell_pace on the battery)', () => {
  const { start } = require('../sa/sa-engine');
  const tick = (ms = 15) => new Promise((res) => setTimeout(res, ms));
  async function boot(ui) {
    const store = await storeMod.open({ idb: null });
    let voiceCb = null; let cancelled = 0;
    const battery = { battery_id: 'b', ui, tasks: [{ id: 'ur.letter_names5', subtask: 'letter_name_identification', response: 'record', lang: 'ur', time_limit_s: 60, grid: GRID.slice(), items: [] }] };
    let hooks = null;
    const fakeRec = { ready: async () => true, start: () => true, stop: async () => null, recording: () => false, onSilence: () => () => {},
      onVoice: (cb) => { voiceCb = cb; return () => { cancelled++; }; } };
    const c = clock();
    const e = await start({ mount: {}, battery, mode: 'proctored', lang: 'ur', session_id: 's-pace', audio_check: false, warmup: false, now: c.now }, {
      core, store: { open: async () => store }, ui: { mount: (el, o) => { hooks = o; return {}; } },
      voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) },
      rec: { create: () => fakeRec }, micState: () => 'ok', now: c.now,
    });
    const r = e.runner;
    r.start(); r.instructionDone(); r.begin();
    hooks.onRecordStart(r.view().task);
    await tick();
    return { r, c, hooks, voice: () => voiceCb, cancelled: () => cancelled };
  }
  test('ON: the recorder\'s onVoice is watched, and a voice reaches runner.voice(); recording stop cancels it', async () => {
    const x = await boot({ one_at_a_time: true, cell_pace: true });
    expect(typeof x.voice()).toBe('function');
    const spy = jest.spyOn(x.r, 'voice');
    x.voice()();
    expect(spy).toHaveBeenCalled();
    x.hooks.onRecordStop(x.r.view().task);
    await tick();
    expect(x.cancelled()).toBe(1);
  });
  test('OFF: no voice watch', async () => {
    const x = await boot({ one_at_a_time: true });
    expect(x.voice()).toBeNull();
  });
});
