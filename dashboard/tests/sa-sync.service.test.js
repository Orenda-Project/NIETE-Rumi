'use strict';
/**
 * The upload queue (dashboard/sa/sa-sync.js): offline keeps everything and says so; back online sends the events and
 * results once acknowledged, then each closed recording as one file (presign → put → register); a refused batch is
 * sent again later (idempotent upsert on the server), with the wait doubling.
 */
const storeMod = require('../sa/sa-store');
const sync = require('../sa/sa-sync');

function fakeTimers() {
  const q = [];
  return { q, set: (f, ms) => { q.push({ f, ms }); return q.length; }, clear: () => {}, run: () => { const x = q.shift(); if (x) x.f(); return x; } };
}

async function seeded() {
  const s = await storeMod.open({ idb: null });
  for (let seq = 1; seq <= 3; seq++) await s.appendEvent({ session_id: 'x', seq, type: 'tap' });
  await s.putResult('x', { task_id: 't1', correct: 2 });
  await s.putChunk('x', 'rec', 0, 'AB', { mime: 'audio/webm' });
  await s.putChunk('x', 'rec', 1, 'CD', { final: true, duration_ms: 4000 });
  await s.putChunk('x', 'open', 0, 'EF', { mime: 'audio/webm' }); // still recording: not sent
  return s;
}

function sinkLog() {
  const calls = [];
  return {
    calls,
    putBatch: async (b) => { calls.push(['batch', b.seq_from, b.seq_to, b.results.map((r) => r.task_id), b.events.some((e) => 'synced' in e)]); return { ok: true, acked_to: b.seq_to }; },
    presignAudio: async (a) => { calls.push(['presign', a.task_id, a.mime, a.bytes]); return { url: 'https://r2.test/u', key: `k/${a.task_id}` }; },
    registerAudio: async (a) => { calls.push(['register', a.task_id, a.key, a.bytes, a.duration_ms]); return { ok: true }; },
  };
}

test('offline: nothing is sent, all of it stays, the status says offline; online sends it once', async () => {
  const s = await seeded();
  const sink = sinkLog();
  let net = false;
  const puts = [];
  const statuses = [];
  const q = sync.create({ store: s, sink, session_id: 'x', online: () => net, timers: fakeTimers(),
    put: async (url, body) => { puts.push([url, body]); }, join: (c) => c.map((x) => x.blob).join(''), onStatus: (st) => statuses.push(st.state) });
  expect(await q.flush()).toMatchObject({ state: 'offline', pending_events: 4, pending_audio: 1 });
  expect(sink.calls).toEqual([]);
  net = true;
  expect(await q.flush()).toMatchObject({ state: 'synced', pending_events: 0, pending_audio: 0 });
  expect(sink.calls).toEqual([
    ['batch', 1, 3, ['t1'], false],
    ['presign', 'rec', 'audio/webm', 4],
    ['register', 'rec', 'k/rec', 4, 4000],
  ]);
  expect(puts).toEqual([['https://r2.test/u', 'ABCD']]);
  const p = await s.pending('x');
  expect([p.events.length, p.results.length, p.chunks.map((c) => c.task_id)]).toEqual([0, 0, ['open']]);
  await q.flush();
  expect(sink.calls).toHaveLength(3); // nothing twice
  expect(statuses).toContain('offline');
});

test('a refused batch stays pending and is retried after a doubling wait', async () => {
  const s = await seeded();
  const t = fakeTimers();
  let fail = true;
  const sink = Object.assign(sinkLog(), { putBatch: async () => (fail ? { ok: false } : { ok: true }) });
  const q = sync.create({ store: s, sink, session_id: 'x', online: () => true, timers: t, put: async () => {}, join: () => 'x' });
  expect((await q.flush()).state).toBe('error');
  expect(t.q[0].ms).toBe(2000);
  await q.flush();
  expect(t.q[1].ms).toBe(4000);
  expect((await s.pending('x')).events).toHaveLength(3);
  fail = false;
  expect((await q.flush()).state).toBe('synced');
  expect((await s.pending('x')).events).toHaveLength(0);
});

test('a partial acknowledgement keeps the rest pending', async () => {
  const s = await seeded();
  const sink = Object.assign(sinkLog(), { putBatch: async () => ({ ok: true, acked_to: 2 }) });
  const q = sync.create({ store: s, sink, session_id: 'x', online: () => true, timers: fakeTimers(), put: async () => {}, join: () => 'x' });
  await q.flush();
  expect((await s.pending('x')).events.map((e) => e.seq)).toEqual([3]);
});
