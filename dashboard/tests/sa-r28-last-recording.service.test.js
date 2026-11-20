'use strict';
/**
 * The last recording of a test, through the real engine, recorder, sync and store (a fake MediaRecorder whose
 * stop event comes late, as on a slow phone; the screens' hooks called as sa-ui calls them).
 *
 * K5: time runs out on the last task, the screen stops the recorder (not awaited there), and the battery ends. The
 * engine's own close finds no recording running, so before this fix it went on at once: sa:battery_end was posted (the
 * coach page may unmount the frame right then) before the recorder's final marker was on the phone, and a recording
 * without its final marker is never uploaded by the sync nor by any drain. Now the battery's end waits for that stop.
 *
 * The end screen's "saving" (a′): after sa:battery_end the engine sends the audio and posts {type:'sa:audio_saved', s,
 * pending_audio, state} once that round is over, so the coach page knows when the last recording is acked.
 */
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const syncMod = require('../sa/sa-sync');
const recMod = require('../sa/sa-rec');
const { start } = require('../sa/sa-engine');

const STOP_LAG_MS = 40;
class SlowStopMR {
  static isTypeSupported(t) { return t === 'audio/webm'; }
  constructor() { this.state = 'inactive'; }
  start() { this.state = 'recording'; setTimeout(() => { if (this.ondataavailable) this.ondataavailable({ data: { size: 5, id: 'x' } }); }, 1); }
  stop() { this.state = 'inactive'; setTimeout(() => { if (this.onstop) this.onstop(); }, STOP_LAG_MS); }
}
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const engines = [];
afterEach(() => { while (engines.length) engines.pop().destroy(); });

const FLUENCY = {
  id: 'ma.fluency1m', subtask: 'mental_math_fluency', mode: 'record', response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 5,
  items: Array.from({ length: 5 }, (_, k) => ({ id: `ma.fluency1m.${k + 1}`, show: `${k} + 1`, target: k + 1 })),
};

async function boot(id, { online = true, put } = {}) {
  const store = await storeMod.open({ idb: null });
  const calls = [];
  const posted = [];
  const listeners = {};
  const win = { location: { origin: 'https://p.test' }, addEventListener: (k, fn) => { listeners[k] = fn; }, removeEventListener() {} };
  win.parent = { postMessage: (m) => { posted.push(m); calls.push(m.type); } };
  const sink = {
    putBatch: async (b) => ({ ok: true, acked_to: b.seq_to }),
    presignAudio: async (a) => { calls.push('presign ' + a.task_id); return { url: 'https://r2/' + a.task_id, key: 'k/' + a.task_id }; },
    registerAudio: async (a) => { calls.push('register ' + a.task_id); return {}; },
  };
  let ui = null;
  let t = 0;
  const e = await start({ mount: {}, battery: { battery_id: 'b-last', tasks: [FLUENCY] }, mode: 'proctored', lang: 'en', embed: true, sink, session_id: id, audio_check: false, warmup: false, one_at_a_time: true }, {
    core, store: { open: async () => store }, ui: { mount: (el, o) => { ui = o; return {}; } },
    voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) },
    sync: { create: (o) => syncMod.create(Object.assign({}, o, { online: () => online, put: put || (async () => { calls.push('put'); }), join: (c) => c.map((x) => x.blob).join('') })) },
    rec: { create: (o) => recMod.create(Object.assign({}, o, { MediaRecorder: SlowStopMR, getUserMedia: async () => ({ getTracks: () => [] }), AudioContext: null })) },
    micState: () => 'ok',
    now: () => t,
    win,
  });
  engines.push(e);
  const r = e.runner;
  r.start(); r.instructionDone(); r.begin();
  const task = r.view().task;
  ui.onRecordStart(task);
  await tick();
  return { e, r, ui, task, store, calls, posted, listeners, clock: (ms) => { t += ms; } };
}

/** Time up on the last task, as the page does it: the frame loop's tick, the screen's recorder stop, the next screen. */
function timeUpAndEnd(x) {
  x.clock(61000);
  x.r.tick();
  x.ui.onRecordStop(x.task);
  x.r.next();
}

test('K5: time up on the last task: sa:battery_end only once the final marker is on the phone', async () => {
  const x = await boot('s-k5');
  timeUpAndEnd(x);
  let finalAtEnd = null;
  for (let i = 0; i < 40 && finalAtEnd === null; i++) {
    // eslint-disable-next-line no-await-in-loop
    await tick(5);
    // the coach page may unmount the frame the moment sa:battery_end arrives: what is on the phone then is all there is
    if (x.posted.some((m) => m.type === 'sa:battery_end')) {
      // eslint-disable-next-line no-await-in-loop
      finalAtEnd = (await x.store.chunks('s-k5')).some((c) => c.task_id === 'ma.fluency1m' && c.final);
    }
  }
  expect(finalAtEnd).toBe(true);
});

test('a′: after sa:battery_end the audio goes, then sa:audio_saved says nothing is left', async () => {
  const x = await boot('s-saved');
  timeUpAndEnd(x);
  await tick(200);
  const types = x.calls.filter((c) => c.startsWith('sa:') || c.startsWith('register'));
  expect(types).toEqual(['sa:battery_ending', 'sa:battery_end', 'register ma.fluency1m', 'sa:audio_saved']);
  expect(x.posted[x.posted.length - 1]).toEqual({ type: 'sa:audio_saved', s: 's-saved', pending_audio: 0, state: 'synced' });
});

test('a′ offline: sa:audio_saved comes at once with the recording still on the phone', async () => {
  const x = await boot('s-off', { online: false });
  timeUpAndEnd(x);
  await tick(200);
  const saved = x.posted.filter((m) => m.type === 'sa:audio_saved');
  expect(saved).toEqual([{ type: 'sa:audio_saved', s: 's-off', pending_audio: 1, state: 'offline' }]);
  expect((await x.store.chunks('s-off')).some((c) => c.final)).toBe(true);
});

test('a′: a failed upload still answers sa:audio_saved (pending), so the page never waits on it', async () => {
  const x = await boot('s-fail', { put: async () => { throw new Error('upload 500'); } });
  timeUpAndEnd(x);
  await tick(200);
  const saved = x.posted.filter((m) => m.type === 'sa:audio_saved');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toEqual(expect.objectContaining({ s: 's-fail', pending_audio: 1 }));
});

test('a′: a coach hold right after sa:battery_end waits for the audio: sa:done follows sa:audio_saved', async () => {
  const x = await boot('s-hold', { put: async () => { await tick(60); x.calls.push('put'); } });
  timeUpAndEnd(x);
  for (let i = 0; i < 40 && !x.calls.includes('sa:battery_end'); i++) await tick(5); // eslint-disable-line no-await-in-loop
  x.listeners.message({ origin: 'https://p.test', data: { type: 'sa:coach_end', s: 's-hold' } });
  await tick(300);
  const types = x.calls.filter((c) => c.startsWith('sa:'));
  expect(types).toEqual(['sa:battery_ending', 'sa:battery_end', 'sa:audio_saved', 'sa:done']);
});
