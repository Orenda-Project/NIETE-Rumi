'use strict';
/**
 * A session with two record tasks (the coach's B3: ur.listening then en.listening, a spoken answer each): both
 * recordings close on the phone and both reach presign → put → register, through the real engine, recorder, sync
 * and store (a fake MediaRecorder; the screens' hooks called as sa-ui calls them).
 */
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const syncMod = require('../sa/sa-sync');
const recMod = require('../sa/sa-rec');
const { start } = require('../sa/sa-engine');

class FakeMR {
  static isTypeSupported(t) { return t === 'audio/webm'; }
  constructor() { this.state = 'inactive'; }
  start() { this.state = 'recording'; setTimeout(() => { if (this.ondataavailable) this.ondataavailable({ data: { size: 5, id: 'x' } }); }, 1); }
  stop() { this.state = 'inactive'; setTimeout(() => { if (this.onstop) this.onstop(); }, 1); }
}
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

test('two record tasks in one session: two recordings closed, two presigned and registered', async () => {
  const store = await storeMod.open({ idb: null });
  const calls = [];
  const sink = {
    putBatch: async (b) => ({ ok: true, acked_to: b.seq_to }),
    presignAudio: async (a) => { calls.push('presign ' + a.task_id); return { url: 'https://r2/' + a.task_id, key: 'k/' + a.task_id }; },
    registerAudio: async (a) => { calls.push('register ' + a.task_id); return {}; },
  };
  let ui = null;
  const battery = { battery_id: 'b3', tasks: [
    { id: 'ur.listening', mode: 'oral', items: [{ id: 'q1' }, { id: 'q2' }] },
    { id: 'en.listening', mode: 'oral', items: [{ id: 'q1' }, { id: 'q2' }] },
  ] };
  const e = await start({ mount: {}, battery, mode: 'proctored', lang: 'en', sink, session_id: 's-two', audio_check: false, warmup: false, oral_practice: false }, {
    core, store: { open: async () => store }, ui: { mount: (el, o) => { ui = o; return {}; } },
    voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) },
    sync: { create: (o) => syncMod.create(Object.assign({}, o, { put: async (u) => { calls.push('put'); }, join: (c) => c.map((x) => x.blob).join('') })) },
    rec: { create: (o) => recMod.create(Object.assign({}, o, { MediaRecorder: FakeMR, getUserMedia: async () => ({ getTracks: () => [] }), AudioContext: null })) },
    micState: () => 'ok',
  });
  const r = e.runner;
  r.start();
  for (const task of battery.tasks) {
    r.instructionDone(); r.begin();
    for (const it of task.items) {
      const t = r.view().task;
      ui.onRecordStart(t, r.view().item); // as sa-ui does once the question has been asked
      await tick();
      ui.onRecordStop(t, r.view().item); // the next screen
      r.answer('spoken');
      await tick();
    }
    r.next();
  }
  await tick(50);
  await e.flushed();
  const chunks = await store.chunks('s-two');
  const finals = chunks.filter((c) => c.final).map((c) => c.task_id).sort();
  expect(finals).toEqual(['en.listening/q1', 'en.listening/q2', 'ur.listening/q1', 'ur.listening/q2']);
  await tick(100);
  expect(calls.filter((c) => c.startsWith('presign')).sort()).toEqual(['presign en.listening/q1', 'presign en.listening/q2', 'presign ur.listening/q1', 'presign ur.listening/q2']);
});
