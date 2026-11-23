'use strict';

/**
 * The session row keeps each item's reach read: cards_reach (the letter-sound picker) and options_reach (a story
 * question), { n, hit, vw, vh } with the item it was read on, from dashboard/sa/sa-ui.js. Coach-led and RDF auto alike.
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

function world(block) {
  const session = { id: SID, coach_user_id: COACH, draw_id: 'd-1', school_id: SCHOOL, visit_key: 'day:x', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'in_progress', device: { block } };
  const synced = [];
  const deps = {
    enabled: async () => true,
    supabase: { from: (t) => chain(t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }] : []) },
    store: { getSession: async () => ({ ok: true, session }), recordTiming: async () => ({ ok: true }), setSessionStatus: async () => ({ ok: true }) },
    saStore: { findByClient: async () => ({ ok: true, sessionId: null }), markSynced: async (id, v) => { synced.push(v); return { ok: true }; }, putResults: async () => ({ ok: true }) },
    now: () => new Date('2026-11-18T09:00:00Z'),
    log: () => {}, logError: () => {},
  };
  return { deps, synced };
}

test.each(['rdf_auto', 'rdf_manual'])('%s: cards_reach and options_reach are kept with their item and values', async (block) => {
  const { deps, synced } = world(block);
  const pick = { n: 5, hit: 3, vw: 360, vh: 640 };
  const mcq = { n: 4, hit: 4, vw: 360, vh: 640 };
  const events = [
    { seq: 1, type: 'cards_reach', task_id: 'ur.letter_pick10', item_id: 'ur.letter_pick10.01', at: '2026-11-18T08:59:01Z', value: pick },
    { seq: 2, type: 'options_reach', task_id: 'en.story_mcq_w3', item_id: 'en.story_w3.q1', at: '2026-11-18T08:59:02Z', value: mcq },
  ];
  const out = await sa.saBatch({ userId: COACH, sessionId: SID, seqFrom: 1, seqTo: 2, events, results: [] }, deps);
  expect(out).toEqual({ status: 'ok', ackedTo: 2 });
  expect(synced[0].events).toEqual([
    { seq: 1, type: 'cards_reach', task_id: 'ur.letter_pick10', item_id: 'ur.letter_pick10.01', at: '2026-11-18T08:59:01Z', data: pick },
    { seq: 2, type: 'options_reach', task_id: 'en.story_mcq_w3', item_id: 'en.story_w3.q1', at: '2026-11-18T08:59:02Z', data: mcq },
  ]);
});
