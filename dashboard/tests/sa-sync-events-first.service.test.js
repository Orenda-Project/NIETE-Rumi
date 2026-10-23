'use strict';
/**
 * The battery's end ahead of the audio (dashboard/sa/sa-sync.js flushEvents): the events and results go up at once,
 * even while recordings are uploading, and the promise settles on the server's ack; no recording is presigned by it.
 * Offline or a refused batch rejects, and everything stays queued for the next flush.
 */
const storeMod = require('../sa/sa-store');
const sync = require('../sa/sa-sync');

function fakeTimers() {
  return { set: () => 1, clear: () => {} };
}

async function seeded() {
  const s = await storeMod.open({ idb: null });
  for (let seq = 1; seq <= 3; seq++) await s.appendEvent({ session_id: 'x', seq, type: 'tap' });
  await s.putResult('x', { task_id: 'ur.story', correct: 0 });
  for (const t of ['ur.story', 'en.story']) {
    await s.putChunk('x', t, 0, 'AB', { mime: 'audio/webm' });
    await s.putChunk('x', t, 1, 'CD', { final: true, duration_ms: 4000 });
  }
  return s;
}

function sinkLog({ batch } = {}) {
  const calls = [];
  const gate = {};
  gate.wait = new Promise((r) => { gate.open = r; });
  return {
    calls,
    gate,
    putBatch: async (b) => {
      calls.push(['batch', b.seq_from, b.seq_to, b.events.map((e) => e.type)]);
      if (batch) return batch(b);
      return { ok: true, acked_to: b.seq_to };
    },
    presignAudio: async (a) => { calls.push(['presign', a.task_id]); await gate.wait; return { url: 'https://r2.test/u', key: `k/${a.task_id}` }; },
    registerAudio: async (a) => { calls.push(['register', a.task_id]); return { ok: true }; },
  };
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('2 recordings uploading: the battery_end batch is sent and acked before the second recording is presigned', async () => {
  const s = await seeded();
  const sink = sinkLog();
  const q = sync.create({ store: s, sink, session_id: 'x', online: () => true, timers: fakeTimers(), put: async () => {}, join: (c) => c.map((x) => x.blob).join('') });
  const round = q.flush();
  await tick();
  expect(sink.calls).toEqual([['batch', 1, 3, ['tap', 'tap', 'tap']], ['presign', 'ur.story']]);
  await s.appendEvent({ session_id: 'x', seq: 4, type: 'battery_end' });
  await q.flushEvents();
  expect(sink.calls).toEqual([['batch', 1, 3, ['tap', 'tap', 'tap']], ['presign', 'ur.story'], ['batch', 4, 4, ['battery_end']]]);
  const p = await s.pending('x');
  expect([p.events.length, p.results.length]).toEqual([0, 0]);
  sink.gate.open();
  await round;
  expect(sink.calls.filter((c) => c[0] === 'register').map((c) => c[1])).toEqual(['ur.story', 'en.story']);
});

test('nothing pending but audio: flushEvents resolves without presigning anything', async () => {
  const s = await seeded();
  await s.markSynced('x', 3, ['ur.story']);
  const sink = sinkLog();
  const q = sync.create({ store: s, sink, session_id: 'x', online: () => true, timers: fakeTimers(), put: async () => {}, join: (c) => c.join('') });
  await q.flushEvents();
  expect(sink.calls).toEqual([]);
});

test('offline, or a refused batch: flushEvents rejects and the rows stay queued', async () => {
  const s = await seeded();
  const off = sync.create({ store: s, sink: sinkLog(), session_id: 'x', online: () => false, timers: fakeTimers() });
  await expect(off.flushEvents()).rejects.toThrow(/offline/);
  const sink = sinkLog({ batch: () => ({ ok: false }) });
  const refused = sync.create({ store: s, sink, session_id: 'x', online: () => true, timers: fakeTimers() });
  await expect(refused.flushEvents()).rejects.toThrow(/refused/);
  expect(sink.calls.map((c) => c[0])).toEqual(['batch']);
  const p = await s.pending('x');
  expect([p.events.length, p.results.length]).toEqual([3, 1]);
});
