'use strict';
/**
 * The audio skip (dashboard/sa/sa-sync.js, RULING #17 ⚠️10): a presign that answers {skip:true, reason} means "this
 * audio is not kept": the recording is deleted from the phone, the task's result goes up again with audio:'not_kept',
 * and nothing is retried. A sink error is not a skip: the audio stays and is tried again.
 */
const storeMod = require('../sa/sa-store');
const sync = require('../sa/sa-sync');

function fakeTimers() {
  const q = [];
  return { q, set: (f, ms) => { q.push({ f, ms }); return q.length; }, clear: () => {} };
}

async function seeded() {
  const s = await storeMod.open({ idb: null });
  await s.appendEvent({ session_id: 'x', seq: 1, type: 'task_end' });
  await s.putResult('x', { task_id: 'ur.story', last_word_index: 12 });
  await s.putChunk('x', 'ur.story', 0, 'AB', { mime: 'audio/webm' });
  await s.putChunk('x', 'ur.story', 1, null, { final: true, duration_ms: 4000 });
  await s.putChunk('x', 'ur.listening/q1', 0, 'CD', { mime: 'audio/webm' });
  await s.putChunk('x', 'ur.listening/q1', 1, null, { final: true, duration_ms: 2000 });
  return s;
}

test('skip: the blob is deleted, the result says not_kept, nothing is uploaded or retried', async () => {
  const s = await seeded();
  const calls = [];
  const sink = {
    putBatch: async (b) => { calls.push(['batch', b.results.map((r) => [r.task_id, r.audio || null, r.audio_reason || null])]); return { ok: true, acked_to: b.seq_to }; },
    presignAudio: async (a) => { calls.push(['presign', a.task_id]); return { skip: true, reason: 'audio_off' }; },
    registerAudio: async () => { calls.push(['register']); return { ok: true }; },
  };
  const puts = [];
  const t = fakeTimers();
  const q = sync.create({ store: s, sink, session_id: 'x', online: () => true, timers: t, put: async (u) => { puts.push(u); }, join: (c) => c.map((x) => x.blob).join(''), localStorage: null });
  const st = await q.flush();
  expect(st.state).toBe('synced');
  expect(puts).toEqual([]);
  expect(calls.filter((c) => c[0] === 'register')).toEqual([]);
  expect(await s.chunks('x')).toEqual([]);
  // the story's result went up again, marked; the listening answer has no result yet, so it is marked when it comes
  expect(calls.filter((c) => c[0] === 'batch').pop()[1]).toEqual([['ur.story', 'not_kept', 'audio_off']]);
  await s.putResult('x', { task_id: 'ur.listening', correct: 1 });
  q.poke();
  await q.flush();
  expect(calls.filter((c) => c[0] === 'batch').pop()[1]).toEqual([['ur.listening', 'not_kept', 'audio_off']]);
  const n = calls.filter((c) => c[0] === 'presign').length;
  expect(n).toBe(2);
  await q.flush();
  expect(calls.filter((c) => c[0] === 'presign').length).toBe(n);
  expect(t.q.filter((x) => x.ms > 0)).toEqual([]); // no backoff: a skip is never retried
});

test('a sink error is not a skip: the audio stays on the phone and is retried', async () => {
  const s = await seeded();
  let fail = true;
  const sink = {
    putBatch: async (b) => ({ ok: true, acked_to: b.seq_to }),
    presignAudio: async (a) => { if (fail) throw new Error('sink 500'); return { url: 'https://r2.test/u', key: `k/${a.task_id}` }; },
    registerAudio: async () => ({ ok: true }),
  };
  const puts = [];
  const t = fakeTimers();
  const q = sync.create({ store: s, sink, session_id: 'x', online: () => true, timers: t, put: async (u) => { puts.push(u); }, join: (c) => c.map((x) => x.blob).join(''), localStorage: null });
  const st = await q.flush();
  expect(st.state).toBe('error');
  expect((await s.chunks('x')).length).toBe(4);
  expect(t.q.length).toBe(1);
  expect((await s.results('x')).find((r) => r.task_id === 'ur.story').audio).toBeUndefined();
  fail = false;
  await q.flush();
  expect(puts.length).toBe(2);
});

test('a reload between the skip and the result keeps the mark: the next page\'s sync still sends not_kept', async () => {
  const s = await storeMod.open({ idb: null });
  await s.putChunk('x', 'ur.listening/q1', 0, 'CD', { mime: 'audio/webm' });
  await s.putChunk('x', 'ur.listening/q1', 1, null, { final: true, duration_ms: 2000 });
  const m = {};
  const ls = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
  const sent = [];
  const sink = {
    putBatch: async (b) => { sent.push(b.results.map((r) => [r.task_id, r.audio || null])); return { ok: true, acked_to: b.seq_to }; },
    presignAudio: async () => ({ skip: true, reason: 'audio_off' }),
    registerAudio: async () => ({ ok: true }),
  };
  const opts = { store: s, sink, session_id: 'x', online: () => true, timers: fakeTimers(), put: async () => {}, join: () => 'x', localStorage: ls };
  await sync.create(opts).flush();
  // the page reloads: a new sync, the result is written only now
  await s.putResult('x', { task_id: 'ur.listening', correct: 1 });
  await sync.create(opts).flush();
  expect(sent.pop()).toEqual([['ur.listening', 'not_kept']]);
});
