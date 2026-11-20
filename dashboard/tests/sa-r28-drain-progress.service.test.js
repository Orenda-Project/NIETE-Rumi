'use strict';
/**
 * The coach page's drain on a slow link, and a recording the server already scored.
 *
 * D1: the drain frame tells the coach page how it moves (sa:drain_progress), so the page ends a drain only when it is
 * stuck, not at a fixed minute while a slow upload is still going. The sync reports each server answer ('ack') and the
 * bytes of an upload ('bytes') through onProgress; the drain passes that hook to every session's sync.
 *
 * D2: a register refused as already_scored for this task's own key marks the recording synced: it is never sent again
 * and does not stay on the phone. Any other refusal stays a failure.
 */
const storeMod = require('../sa/sa-store');
const syncMod = require('../sa/sa-sync');
const sinkCoach = require('../sa/sink-coach');
const { drain } = require('../sa/sa-page');

const timers = { set: () => 0, clear() {} };

async function phoneWithRecording(id = 's1', task = 'ma.fluency1m') {
  const s = await storeMod.open({ idb: null });
  await s.putSession({ session_id: id, mode: 'proctored', battery_id: 'b' });
  await s.appendEvent({ session_id: id, seq: 1, type: 'tap' });
  await s.putResult(id, { task_id: task, correct: 1 });
  await s.putChunk(id, task, 0, 'AB', { mime: 'audio/webm' });
  await s.putChunk(id, task, 1, 'CD', { final: true, duration_ms: 4000 });
  return s;
}

function refused(reason, status = 400) {
  const e = new Error('coach sink /register ' + status);
  e.status = status;
  e.reason = reason;
  return e;
}

describe('D2: already_scored on register', () => {
  test('K9: the recording is marked synced, stays off the phone, and is not uploaded again', async () => {
    const s = await phoneWithRecording();
    const calls = [];
    const sink = {
      putBatch: async (b) => ({ ok: true, acked_to: b.seq_to }),
      presignAudio: async (a) => { calls.push('presign ' + a.task_id); return { url: 'https://r2/u', key: 'k/' + a.task_id }; },
      registerAudio: async () => { calls.push('register'); throw refused('already_scored'); },
    };
    const sy = syncMod.create({ store: s, sink, session_id: 's1', online: () => true, timers, put: async () => { calls.push('put'); }, join: (c) => c.map((x) => x.blob).join('') });
    const st = await sy.flush();
    expect(st.state).toBe('synced');
    expect((await s.pending('s1')).chunks.filter((c) => c.final)).toHaveLength(0);
    await sy.flush();
    expect(calls).toEqual(['presign ma.fluency1m', 'put', 'register']);
  });

  test('any other refusal stays a failure: the recording stays on the phone for a later try', async () => {
    const s = await phoneWithRecording();
    const sink = {
      putBatch: async (b) => ({ ok: true, acked_to: b.seq_to }),
      presignAudio: async () => ({ url: 'https://r2/u', key: 'k' }),
      registerAudio: async () => { throw refused('upload_missing', 400); },
    };
    const sy = syncMod.create({ store: s, sink, session_id: 's1', online: () => true, timers, put: async () => {}, join: (c) => c.join('') });
    const st = await sy.flush();
    expect(st.state).toBe('error');
    expect((await s.pending('s1')).chunks.filter((c) => c.final)).toHaveLength(1);
  });

  test("the coach sink's refusal carries the server's reason", async () => {
    const f = async () => ({ ok: false, status: 400, json: async () => ({ success: false, status: 'invalid', reason: 'already_scored' }) });
    const sink = sinkCoach.create({ fetch: f, localStorage: null, window: null });
    await expect(sink.registerAudio({ session_id: 's1', task_id: 't', key: 'k', bytes: 1 })).rejects.toMatchObject({ status: 400, reason: 'already_scored' });
  });

  test('a refusal without a JSON body is still a plain failure', async () => {
    const f = async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
    const sink = sinkCoach.create({ fetch: f, localStorage: null, window: null });
    const err = await sink.registerAudio({ session_id: 's1', task_id: 't', key: 'k', bytes: 1 }).catch((e) => e);
    expect(err).toMatchObject({ status: 502 });
    expect(err.reason).toBeUndefined();
  });
});

describe('D1: the drain says how it moves', () => {
  test("each server answer and an upload's bytes reach onProgress, through the drain", async () => {
    const s = await phoneWithRecording('child-1');
    const seen = [];
    const sink = {
      putBatch: async (b) => ({ ok: true, acked_to: b.seq_to }),
      presignAudio: async () => ({ url: 'https://r2/u', key: 'k' }),
      registerAudio: async () => ({ status: 'ok' }),
    };
    const put = async (url, body, mime, onBytes) => { onBytes(1); onBytes(4); };
    const sync = { create: (o) => syncMod.create(Object.assign({}, o, { put, join: (c) => c.map((x) => x.blob).join('') })) };
    const out = await drain({ store: s, sync, sink: () => sink, online: () => true, timers, onProgress: (k, n) => seen.push([k, n]) });
    expect(out).toEqual([{ s: 'child-1', state: 'synced', pending_events: 0, pending_audio: 0 }]);
    // batch ack, presign answer, two byte counts, register answer
    expect(seen).toEqual([['ack', 1], ['ack', 1], ['bytes', 1], ['bytes', 4], ['ack', 1]]);
  });

  test('a refusal is not progress: a refused batch, a refused presign, a refused register say nothing', async () => {
    const s = await phoneWithRecording('child-1');
    const seen = [];
    const sink = {
      putBatch: async () => ({ ok: false }),
      presignAudio: async () => ({ url: 'https://r2/u', key: 'k' }),
      registerAudio: async () => { throw refused('upload_missing'); },
    };
    const put = async (url, body, mime, onBytes) => { onBytes(4); };
    const sync = { create: (o) => syncMod.create(Object.assign({}, o, { put, join: (c) => c.map((x) => x.blob).join('') })) };
    await drain({ store: s, sync, sink: () => sink, online: () => true, timers, onProgress: (k, n) => seen.push([k, n]) });
    // only the accepted presign and the bytes: no ack for the refused batch or the refused register
    expect(seen).toEqual([['ack', 1], ['bytes', 4]]);
    const t = await phoneWithRecording('child-2');
    const seen2 = [];
    const sink2 = { putBatch: async () => ({ ok: false }), presignAudio: async () => { throw refused('bad_task'); }, registerAudio: async () => ({}) };
    await drain({ store: t, sync, sink: () => sink2, online: () => true, timers, onProgress: (k, n) => seen2.push([k, n]) });
    expect(seen2).toEqual([]);
  });

  test('a register found already scored is progress (the recording leaves the phone)', async () => {
    const s = await phoneWithRecording('child-1');
    const seen = [];
    const sink = {
      putBatch: async (b) => ({ ok: true, acked_to: b.seq_to }),
      presignAudio: async () => ({ url: 'https://r2/u', key: 'k' }),
      registerAudio: async () => { throw refused('already_scored'); },
    };
    const sync = { create: (o) => syncMod.create(Object.assign({}, o, { put: async () => {}, join: (c) => c.map((x) => x.blob).join('') })) };
    await drain({ store: s, sync, sink: () => sink, online: () => true, timers, onProgress: (k) => seen.push(k) });
    expect(seen).toEqual(['ack', 'ack', 'ack']);
  });

  test("the default upload counts bytes by XMLHttpRequest's upload events when asked", async () => {
    const sent = [];
    class FakeXHR {
      constructor() { this.upload = {}; this.status = 0; }
      open(m, u) { sent.push([m, u]); }
      setRequestHeader() {}
      send() { this.upload.onprogress({ loaded: 2 }); this.upload.onprogress({ loaded: 4 }); this.status = 200; this.onload(); }
    }
    // the browser's global: the module reads it as self (its UMD root)
    const had = Object.prototype.hasOwnProperty.call(global, 'self');
    global.self = { XMLHttpRequest: FakeXHR };
    try {
      let browserSync;
      jest.isolateModules(() => { browserSync = require('../sa/sa-sync'); });
      const s = await phoneWithRecording();
      const seen = [];
      const sink = { putBatch: async (b) => ({ ok: true, acked_to: b.seq_to }), presignAudio: async () => ({ url: 'https://r2/u', key: 'k' }), registerAudio: async () => ({}) };
      const sy = browserSync.create({ store: s, sink, session_id: 's1', online: () => true, timers, join: (c) => c.map((x) => x.blob).join(''), onProgress: (k, n) => seen.push([k, n]) });
      expect((await sy.flush()).state).toBe('synced');
      expect(sent).toEqual([['PUT', 'https://r2/u']]);
      expect(seen.filter((x) => x[0] === 'bytes')).toEqual([['bytes', 2], ['bytes', 4]]);
    } finally {
      if (had) global.self = undefined; else delete global.self;
    }
  });
});
