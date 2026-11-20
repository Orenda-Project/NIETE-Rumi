'use strict';

/**
 * Round 28: the microphone check's answer `mic_check` { value: { ok, rms } } is an audit row on the session. One "no"
 * there skips every speaking task for that child (sa-core.js micChecked → gates.mic_ok), and without the row a read
 * cannot say which way the check went. One per attempt, the LAST (a retry overwrites), outside the 200 cap
 * (sa-store keepEvents), as record_stop is per task.
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

const check = (seq, ok, rms, extra = {}) => ({ seq, type: 'mic_check', value: { ok, rms }, ...extra });

function keepEventsFresh() {
  jest.resetModules();
  jest.doMock('../../shared/config/supabase', () => ({}));
  return require('../../shared/services/child-test/sa-store').__internals.keepEvents;
}

test('the batch keeps mic_check with { ok, rms }, the last one of the batch', async () => {
  const { deps, synced } = world();
  const events = [
    { seq: 1, type: 'session_start', at: '2026-11-02T08:59:00Z' },
    check(2, false, 0.001, { at: '2026-11-02T08:59:20Z' }),
    check(3, true, 0.08, { at: '2026-11-02T08:59:40Z' }),
  ];
  const out = await sa.saBatch({ userId: COACH, sessionId: SID, seqFrom: 1, seqTo: 3, events, results: [] }, deps);
  expect(out).toEqual({ status: 'ok', ackedTo: 3 });
  expect(synced[0].events).toEqual([
    { seq: 1, type: 'session_start', task_id: null, at: '2026-11-02T08:59:00Z', data: null },
    { seq: 3, type: 'mic_check', task_id: null, at: '2026-11-02T08:59:40Z', data: { ok: true, rms: 0.08 } },
  ]);
});

test('a "no" at the check is kept as it is: ok false, with its rms', async () => {
  const { deps, synced } = world();
  await sa.saBatch({ userId: COACH, sessionId: SID, seqFrom: 1, seqTo: 1, events: [check(1, false, null, { at: '2026-11-02T08:59:20Z' })], results: [] }, deps);
  expect(synced[0].events).toEqual([{ seq: 1, type: 'mic_check', task_id: null, at: '2026-11-02T08:59:20Z', data: { ok: false, rms: null } }]);
});

test('at the 200 cap the mic_check survives', () => {
  const keepEvents = keepEventsFresh();
  const many = [check(1, false, 0.002), ...Array.from({ length: 230 }, (_, i) => ({ seq: i + 2, type: 'visibility_lost' }))];
  const kept = keepEvents([], many);
  expect(kept.filter((e) => e.type === 'mic_check')).toEqual([check(1, false, 0.002)]);
  expect(kept.filter((e) => e.type === 'visibility_lost')).toHaveLength(200);
});

test('every row kept before is still kept, and a retry across batches keeps only the last check', () => {
  const keepEvents = keepEventsFresh();
  const base = Array.from({ length: 210 }, (_, i) => ({ seq: i + 10, type: i % 3 ? 'visibility_lost' : 'voice_held' }));
  const before = keepEvents([], base);
  const first = keepEvents([], [check(1, false, 0.001), ...base]);
  const seqs = new Set(first.map((e) => e.seq));
  expect(before.every((e) => seqs.has(e.seq))).toBe(true);
  const next = keepEvents(first, [check(300, true, 0.07)]);
  expect(next.filter((e) => e.type === 'mic_check').map((e) => e.seq)).toEqual([300]);
});

test('a coach Restart keeps each attempt\'s own last check', () => {
  const keepEvents = keepEventsFresh();
  const rows = [check(-30, false, 0.001), check(-28, false, 0.002), { seq: -1, type: 'restart' }, check(2, true, 0.09)];
  const kept = keepEvents([], rows);
  expect(kept.filter((e) => e.type === 'mic_check').map((e) => [e.seq, e.value.ok])).toEqual([[-28, false], [2, true]]);
});
