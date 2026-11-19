'use strict';

/**
 * Round 28: the build a session ran on reaches its kept events. device_ready carries page / sw / session (sa-page.js),
 * and worker_swap { from, to, task } marks a newer worker taking the page over mid-session; it was dropped by the batch
 * before (only the KEPT list is kept).
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
  const session = { id: SID, coach_user_id: COACH, draw_id: 'd-1', school_id: SCHOOL, visit_key: 'day:x', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'in_progress', device: { block: 'rdf_auto' } };
  const synced = [];
  const deps = {
    enabled: async () => true,
    supabase: { from: (t) => chain(t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }] : []) },
    store: { getSession: async () => ({ ok: true, session }), recordTiming: async () => ({ ok: true }), setSessionStatus: async () => ({ ok: true }) },
    saStore: { findByClient: async () => ({ ok: true, sessionId: null }), markSynced: async (id, v) => { synced.push(v); return { ok: true }; }, putResults: async () => ({ ok: true }) },
    now: () => new Date('2026-10-28T09:00:00Z'),
    log: () => {}, logError: () => {},
  };
  return { deps, synced };
}

test('device_ready keeps page / sw / session, and worker_swap is kept with its task', async () => {
  const { deps, synced } = world();
  const ready = { ready: true, voice: 'clips', persisted: true, clips_total: 144, clips_cached: 144, page: 'sa-41', sw: 'sa-41+sa-42', session: 'sa-session-v29' };
  const swap = { from: 'sa-41', to: 'sa-42', task: 'ur.letter_sounds' };
  const events = [
    { seq: 1, type: 'session_start', at: '2026-11-19T08:59:00Z' },
    { seq: 2, type: 'device_ready', at: '2026-11-19T08:59:40Z', value: ready },
    { seq: 3, type: 'worker_swap', task_id: 'ur.letter_sounds', at: '2026-11-19T09:00:10Z', value: swap },
  ];
  const out = await sa.saBatch({ userId: COACH, sessionId: SID, seqFrom: 1, seqTo: 3, events, results: [] }, deps);
  expect(out).toEqual({ status: 'ok', ackedTo: 3 });
  const kept = synced[0].events;
  expect(kept.map((e) => e.type)).toEqual(['session_start', 'device_ready', 'worker_swap']);
  expect(kept[1].data).toEqual(ready);
  expect(kept[2]).toEqual({ seq: 3, type: 'worker_swap', task_id: 'ur.letter_sounds', at: '2026-11-19T09:00:10Z', data: swap });
});
