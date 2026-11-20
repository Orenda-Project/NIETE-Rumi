'use strict';

/**
 * Round 28: the recorder's `record_stop` { task_id, item_id?, value: { duration_ms, parts } } is an audit row on the
 * session, so a read can tell a recording whose closing marker was written (the engine logs it only after that write)
 * from one that never was, and size a take against the task's time. One per task and attempt, the LAST, and outside
 * the 200 cap (sa-store keepEvents): bounded by the task count, it displaces no other row and is never dropped.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';
const SID = 'sess-1';

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

function world() {
  const session = { id: SID, coach_user_id: COACH, draw_id: 'd-1', school_id: SCHOOL, visit_key: 'day:x', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'in_progress', device: { block: 'rdf_manual' } };
  const synced = [];
  const deps = {
    enabled: async () => true,
    supabase: { from: (t) => chain(t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }] : []) },
    store: { getSession: async () => ({ ok: true, session }), recordTiming: async () => ({ ok: true }), setSessionStatus: async () => ({ ok: true }) },
    saStore: { findByClient: async () => ({ ok: true, sessionId: null }), markSynced: async (id, v) => { synced.push(v); return { ok: true }; }, putResults: async () => ({ ok: true }) },
    now: () => new Date('2026-11-02T09:00:00Z'),
    log: () => {}, logError: () => {},
  };
  return { deps, synced };
}

const stop = (seq, task, ms, extra = {}) => ({ seq, type: 'record_stop', task_id: task, value: { duration_ms: ms, parts: Math.round(ms / 1000) }, ...extra });

function keepEventsFresh() {
  jest.resetModules();
  jest.doMock('../../shared/config/supabase', () => ({}));
  return require('../../shared/services/child-test/sa-store').__internals.keepEvents;
}

test('the batch keeps record_stop, the last one per task of the batch, with its item and values', async () => {
  const { deps, synced } = world();
  const events = [
    { seq: 1, type: 'session_start', at: '2026-11-02T08:59:00Z' },
    stop(2, 'ur.listening', 4100, { item_id: 'q1', at: '2026-11-02T09:00:00Z' }),
    stop(3, 'ur.listening', 3900, { item_id: 'q2', at: '2026-11-02T09:00:10Z' }),
    stop(4, 'ma.fluency1m', 60020, { at: '2026-11-02T09:02:00Z' }),
  ];
  const out = await sa.saBatch({ userId: COACH, sessionId: SID, seqFrom: 1, seqTo: 4, events, results: [] }, deps);
  expect(out).toEqual({ status: 'ok', ackedTo: 4 });
  expect(synced[0].events).toEqual([
    { seq: 1, type: 'session_start', task_id: null, at: '2026-11-02T08:59:00Z', data: null },
    { seq: 3, type: 'record_stop', task_id: 'ur.listening', item_id: 'q2', at: '2026-11-02T09:00:10Z', data: { duration_ms: 3900, parts: 4 } },
    { seq: 4, type: 'record_stop', task_id: 'ma.fluency1m', at: '2026-11-02T09:02:00Z', data: { duration_ms: 60020, parts: 60 } },
  ]);
});

test('r1: a session already at the 200 cap still keeps its last task\'s record_stop', () => {
  const keepEvents = keepEventsFresh();
  const many = Array.from({ length: 230 }, (_, i) => ({ seq: i + 1, type: 'visibility_lost' }));
  many.push(stop(231, 'ma.fluency1m', 60020));
  const kept = keepEvents([], many);
  expect(kept.filter((e) => e.type === 'record_stop')).toEqual([stop(231, 'ma.fluency1m', 60020)]);
  expect(kept.filter((e) => e.type === 'visibility_lost')).toHaveLength(200);
});

test('r2: every row kept before is still kept (record_stop rows displace nothing)', () => {
  const keepEvents = keepEventsFresh();
  const base = Array.from({ length: 210 }, (_, i) => ({ seq: i + 1, type: i % 3 ? 'visibility_lost' : 'voice_held', task_id: `t${i % 7}` }));
  const before = keepEvents([], base);
  const withStops = [...base, ...Array.from({ length: 15 }, (_, k) => stop(300 + k, `task${k}`, 1000 * (k + 1)))];
  const after = keepEvents([], withStops);
  const seqs = new Set(after.map((e) => e.seq));
  expect(before.every((e) => seqs.has(e.seq))).toBe(true);
  expect(after.filter((e) => e.type === 'record_stop')).toHaveLength(15);
});

test('r3: a per-item task keeps its LAST stop, across batches too', () => {
  const keepEvents = keepEventsFresh();
  const first = keepEvents([], [stop(10, 'ur.listening', 4100, { item_id: 'q1' }), stop(12, 'ur.listening', 3800, { item_id: 'q2' })]);
  expect(first.map((e) => e.seq)).toEqual([12]);
  const next = keepEvents(first, [stop(15, 'ur.listening', 5000, { item_id: 'q3' }), stop(16, 'en.listening', 4000, { item_id: 'q1' })]);
  expect(next.map((e) => [e.seq, e.task_id, e.item_id])).toEqual([[15, 'ur.listening', 'q3'], [16, 'en.listening', 'q1']]);
});

test('r4: after a coach Restart, the ended attempt keeps its own last stop beside the new attempt\'s', () => {
  const keepEvents = keepEventsFresh();
  // restartAttempt moves the ended attempt's rows below one restart (negative seqs)
  const rows = [
    stop(-20, 'ma.fluency1m', 30000), stop(-18, 'ma.fluency1m', 31000), { seq: -1, type: 'restart' },
    stop(5, 'ma.fluency1m', 60000), stop(9, 'ma.fluency1m', 60010),
  ];
  const kept = keepEvents([], rows);
  expect(kept.filter((e) => e.type === 'record_stop').map((e) => e.seq)).toEqual([-18, 9]);
  expect(kept.some((e) => e.type === 'restart')).toBe(true);
});
