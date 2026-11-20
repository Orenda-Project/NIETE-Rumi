'use strict';

/**
 * Round 28: a recording whose closing marker never reached the phone is closed and sent by the drain, which logs one
 * `audio_recovered` { task_id, value: { parts_n } } on that session (dashboard/sa/sa-page.js closeOrphans). The batch keeps
 * it on the session even after the battery's end, and the cap never drops it (sa-store AUDIT), so a read can join the
 * take to its block and size the cut.
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
  const session = { id: SID, coach_user_id: COACH, draw_id: 'd-1', school_id: SCHOOL, visit_key: 'day:x', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', device: { block: 'rdf_manual' } };
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

test('the batch keeps audio_recovered with its task, item and parts_n, after the battery has ended', async () => {
  const { deps, synced } = world();
  const events = [
    { seq: 41, type: 'audio_recovered', task_id: 'ma.fluency1m', at: '2026-11-02T09:20:00Z', value: { parts_n: 57 } },
    { seq: 42, type: 'audio_recovered', task_id: 'ur.listening', item_id: 'q2', at: '2026-11-02T09:20:01Z', value: { parts_n: 4 } },
  ];
  const out = await sa.saBatch({ userId: COACH, sessionId: SID, seqFrom: 41, seqTo: 42, events, results: [] }, deps);
  expect(out).toEqual({ status: 'ok', ackedTo: 42 });
  expect(synced[0].events).toEqual([
    { seq: 41, type: 'audio_recovered', task_id: 'ma.fluency1m', at: '2026-11-02T09:20:00Z', data: { parts_n: 57 } },
    { seq: 42, type: 'audio_recovered', task_id: 'ur.listening', item_id: 'q2', at: '2026-11-02T09:20:01Z', data: { parts_n: 4 } },
  ]);
});

test('the kept-events cap never drops an audio_recovered (sa-store AUDIT)', () => {
  jest.resetModules();
  jest.doMock('../../shared/config/supabase', () => ({}));
  const { keepEvents } = require('../../shared/services/child-test/sa-store').__internals;
  const many = Array.from({ length: 250 }, (_, i) => ({ seq: i + 1, type: 'visibility_lost' }));
  many.push({ seq: 251, type: 'audio_recovered', task_id: 'ma.fluency1m', data: { parts_n: 57 } });
  const kept = keepEvents([], many);
  expect(kept.filter((e) => e.type === 'audio_recovered')).toHaveLength(1);
  expect(kept.filter((e) => e.type === 'visibility_lost')).toHaveLength(200);
});
