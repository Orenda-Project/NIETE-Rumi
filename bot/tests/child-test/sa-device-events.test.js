'use strict';

/**
 * Round 8 (the reviewer's "the voice is not available, try again" and "it takes very long for the screen to appear"):
 * the phone's own readiness events reach the session's kept events, so a slow or refused start can be read afterwards.
 * device_ready ({ ready, voice, clips_total, clips_cached, persisted }), voice_not_ready and voice_retry were dropped by
 * the batch before (only the KEPT list is kept). offline / online stay dropped: a flapping network would fill the cap.
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

test('device_ready, voice_not_ready and voice_retry are kept with their values; offline / online are not', async () => {
  const { deps, synced } = world();
  const ready = { ready: true, voice: 'none', persisted: false, clips_total: 144, clips_cached: 38 };
  const events = [
    { seq: 1, type: 'session_start', at: '2026-10-28T08:59:00Z' },
    { seq: 2, type: 'device_ready', at: '2026-10-28T08:59:40Z', value: ready },
    { seq: 3, type: 'voice_not_ready', at: '2026-10-28T08:59:40Z' },
    { seq: 4, type: 'voice_retry', at: '2026-10-28T08:59:55Z', value: { voice: 'clips', clips_cached: 144 } },
    { seq: 5, type: 'offline', at: '2026-10-28T09:00:10Z' },
    { seq: 6, type: 'online', at: '2026-10-28T09:00:30Z' },
    { seq: 7, type: 'item_shown', at: '2026-10-28T09:00:31Z' },
  ];
  const out = await sa.saBatch({ userId: COACH, sessionId: SID, seqFrom: 1, seqTo: 7, events, results: [] }, deps);
  expect(out).toEqual({ status: 'ok', ackedTo: 7 });
  const kept = synced[0].events;
  expect(kept.map((e) => e.type)).toEqual(['device_ready', 'voice_not_ready', 'voice_retry']);
  expect(kept[0]).toEqual({ seq: 2, type: 'device_ready', task_id: null, at: '2026-10-28T08:59:40Z', data: ready });
  expect(kept[2].data).toEqual({ voice: 'clips', clips_cached: 144 });
});
