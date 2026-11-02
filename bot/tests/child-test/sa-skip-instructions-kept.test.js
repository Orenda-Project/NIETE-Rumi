'use strict';

/**
 * Round 9 item 3 (sa_r9_skip_instructions): coach-led RDF, the coach skipped a part's instructions. The phone's
 * `skip_instructions` event { by: 'coach', from, practice_left } is a skip like the others: the batch keeps it on the
 * session (STOP_TYPES), the cap never drops it (sa-store AUDIT), and the dashboard lists it with the session's stops.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';
const SID = 'sess-1';
const SKIP = { by: 'coach', from: 'practice', practice_left: 1 };

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

test('the batch keeps skip_instructions with its task and values (a skip, in STOP_TYPES)', async () => {
  expect(sa.STOP_TYPES).toContain('skip_instructions');
  const { deps, synced } = world();
  const events = [
    { seq: 1, type: 'session_start', at: '2026-11-02T08:59:00Z' },
    { seq: 2, type: 'skip_instructions', task_id: 'ur.letter_names5', at: '2026-11-02T08:59:40Z', value: SKIP },
    { seq: 3, type: 'practice_answer', task_id: 'ur.letter_names5', at: '2026-11-02T08:59:41Z' },
  ];
  const out = await sa.saBatch({ userId: COACH, sessionId: SID, seqFrom: 1, seqTo: 3, events, results: [] }, deps);
  expect(out).toEqual({ status: 'ok', ackedTo: 3 });
  expect(synced[0].events).toEqual([{ seq: 2, type: 'skip_instructions', task_id: 'ur.letter_names5', at: '2026-11-02T08:59:40Z', data: SKIP }]);
});

test('the kept-events cap never drops a skip_instructions (sa-store AUDIT)', () => {
  jest.resetModules();
  jest.doMock('../../shared/config/supabase', () => ({}));
  const { keepEvents } = require('../../shared/services/child-test/sa-store').__internals;
  const many = Array.from({ length: 250 }, (_, i) => ({ seq: i + 1, type: 'visibility_lost' }));
  many.push({ seq: 251, type: 'skip_instructions', task_id: 'ur.letter_names5', data: SKIP });
  const kept = keepEvents([], many);
  expect(kept.filter((e) => e.type === 'skip_instructions')).toHaveLength(1);
  expect(kept.filter((e) => e.type === 'visibility_lost')).toHaveLength(200);
});
