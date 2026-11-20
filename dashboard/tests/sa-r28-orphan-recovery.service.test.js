'use strict';
/**
 * A recording left without its closing marker (the page killed before the recorder's stop was written): its 1 s chunks
 * are on the phone, but the sync and the drain send only a recording marked final, so it was never sent. The drain now
 * closes such a take itself when the session is over (ended, or nothing logged for 10 min) or the task ran out of time,
 * never in a session still running: a closing marker flagged final_synth, then the usual upload, the register call
 * carrying final_synth and parts_n (the chunks sent), and one kept event audio_recovered { parts_n } on the session so
 * the reads can find the take. Any other chunk-only take stays on the phone, counted as orphan_kept.
 */
const storeMod = require('../sa/sa-store');
const syncMod = require('../sa/sa-sync');
const { drain } = require('../sa/sa-page');

const timers = { set: () => 0, clear() {} };
const NOW = Date.parse('2026-11-20T08:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();

async function phone({ ended = false, lastAt = ago(30), stop = 'time_up', parts = 3, final = false } = {}) {
  const s = await storeMod.open({ idb: null });
  await s.putSession({ session_id: 'c-1', mode: 'proctored', battery_id: 'b', ended });
  for (let seq = 1; seq <= 4; seq++) await s.appendEvent({ session_id: 'c-1', seq, type: 'tap', at: seq === 4 ? lastAt : ago(40), synced: 1 });
  await s.putResult('c-1', { task_id: 'ma.fluency1m', stop_reason: stop, synced: 1 });
  for (let p = 0; p < parts; p++) await s.putChunk('c-1', 'ma.fluency1m', p, `b${p}`, { mime: 'audio/webm', ext: 'webm', synced: 0 });
  if (final) await s.putChunk('c-1', 'ma.fluency1m', parts, null, { mime: 'audio/webm', ext: 'webm', final: true, duration_ms: 3000 });
  return s;
}

function sinkLog() {
  const calls = [];
  const sink = {
    putBatch: async (b) => { calls.push({ batch: b.events.map((e) => [e.seq, e.type, e.task_id, e.value]) }); return { ok: true, acked_to: b.seq_to }; },
    presignAudio: async (a) => ({ url: 'https://r2/' + a.task_id, key: 'k/' + a.task_id }),
    registerAudio: async (a) => { calls.push({ register: a }); return {}; },
  };
  return { calls, sink };
}
const sync = { create: (o) => syncMod.create(Object.assign({}, o, { put: async () => {}, join: (c) => c.map((x) => x.blob).join('') })) };
const run = (s, sink) => drain({ store: s, sync, sink: () => sink, online: () => true, timers, now: () => NOW });

test('K7: a time-up take with no closing marker, session over: closed as final_synth, sent, registered with parts_n', async () => {
  const s = await phone({ ended: true });
  const { calls, sink } = sinkLog();
  const out = await run(s, sink);
  const reg = calls.filter((c) => c.register).map((c) => c.register);
  expect(reg).toHaveLength(1);
  expect(reg[0]).toEqual(expect.objectContaining({ session_id: 'c-1', task_id: 'ma.fluency1m', key: 'k/ma.fluency1m', final_synth: true, parts_n: 3 }));
  expect((await s.pending('c-1')).chunks).toEqual([]);
  // the kept event names the take, after the session's own events
  const sent = calls.filter((c) => c.batch).flatMap((c) => c.batch);
  expect(sent).toEqual([[5, 'audio_recovered', 'ma.fluency1m', { parts_n: 3 }]]);
  expect(out).toEqual([expect.objectContaining({ s: 'c-1', state: 'synced', pending_audio: 0, recovered: 1 })]);
});

test('K7: the session not marked ended but silent for 10 min or more counts as over', async () => {
  const s = await phone({ ended: false, lastAt: ago(11), stop: 'coach_end' });
  const { calls, sink } = sinkLog();
  await run(s, sink);
  expect(calls.filter((c) => c.register)).toHaveLength(1);
});

test('K7b: a chunk-only take in a session still running (not ended, last event under 10 min) stays on the phone', async () => {
  const s = await phone({ ended: false, lastAt: ago(2), stop: 'coach_end' });
  const { calls, sink } = sinkLog();
  const out = await run(s, sink);
  expect(calls.filter((c) => c.register)).toEqual([]);
  expect((await s.chunks('c-1')).some((c) => c.final)).toBe(false);
  expect((await s.pending('c-1')).chunks).toHaveLength(3);
  expect(out).toEqual([expect.objectContaining({ s: 'c-1', orphan_kept: 1 })]);
});

test('K7b: a running session is never closed, even on a time-up task', async () => {
  const s = await phone({ ended: false, lastAt: ago(2), stop: 'time_up' });
  const { calls, sink } = sinkLog();
  await run(s, sink);
  expect(calls.filter((c) => c.register)).toEqual([]);
});

test('a take with its own closing marker goes as before: no final_synth, no parts_n, no recovered event', async () => {
  const s = await phone({ ended: true, final: true });
  const { calls, sink } = sinkLog();
  const out = await run(s, sink);
  const reg = calls.filter((c) => c.register).map((c) => c.register);
  expect(reg).toHaveLength(1);
  expect(reg[0].final_synth).toBeUndefined();
  expect(reg[0].parts_n).toBeUndefined();
  expect(calls.filter((c) => c.batch)).toEqual([]);
  expect(out[0].recovered).toBeUndefined();
});

test('offline: the take is closed on the phone and goes on the next online drain, once', async () => {
  const s = await phone({ ended: true });
  const { calls, sink } = sinkLog();
  let net = false;
  const go = () => drain({ store: s, sync, sink: () => sink, online: () => net, timers, now: () => NOW });
  await go();
  expect(calls).toEqual([]);
  net = true;
  await go();
  await go();
  expect(calls.filter((c) => c.register)).toHaveLength(1);
  expect(calls.filter((c) => c.batch).flatMap((c) => c.batch).filter((e) => e[1] === 'audio_recovered')).toHaveLength(1);
});
