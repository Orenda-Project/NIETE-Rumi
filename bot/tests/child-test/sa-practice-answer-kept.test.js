'use strict';

/**
 * The child's practice taps reach the session row. The engine (dashboard/sa/sa-core.js practiceAnswer) logs one
 * practice_answer { task_id, item_id, value: { value, ok, try } } per practice tap: retry once on a wrong answer, then the
 * right one is shown, so at most 2 per answerable practice item. The letter-sound picker has one answerable practice item
 * (the first is modelled), the story MCQ one, the grid / keypad / choice parts at most two: at most 4 per part. The batch
 * keeps them (KEPT, not behind any switch) with their item, each event's data inside the 300-character cap, and never
 * more than 4 per part in one batch.
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

const at = (s) => `2026-11-18T08:59:${String(s).padStart(2, '0')}Z`;
const tap = (seq, task, item, value, ok, tryN) => ({ seq, type: 'practice_answer', task_id: task, item_id: item, at: at(seq), t_ms: seq * 1000, session_id: 'phone-1', value: { value, ok, try: tryN } });

describe.each(['rdf_auto', 'rdf_manual'])('%s: the batch keeps practice_answer', (block) => {
  test('the picker\'s and the MCQ\'s practice taps are kept with their item and value, each under 300 characters', async () => {
    const { deps, synced } = world(block);
    const events = [
      { seq: 1, type: 'session_start', at: at(1) },
      tap(2, 'ur.letter_pick10', 'ur.letter_pick10.p2', 'پ', false, 1),
      tap(3, 'ur.letter_pick10', 'ur.letter_pick10.p2', 'ت', false, 2),
      tap(4, 'en.story_mcq_w3', 'en.story_mcq_w3.p1', 2, true, 1),
    ];
    const out = await sa.saBatch({ userId: COACH, sessionId: SID, seqFrom: 1, seqTo: 4, events, results: [] }, deps);
    expect(out).toEqual({ status: 'ok', ackedTo: 4 });
    const kept = synced[0].events;
    expect(kept).toEqual([
      { seq: 1, type: 'session_start', task_id: null, at: at(1), data: null },
      { seq: 2, type: 'practice_answer', task_id: 'ur.letter_pick10', item_id: 'ur.letter_pick10.p2', at: at(2), data: { value: 'پ', ok: false, try: 1 } },
      { seq: 3, type: 'practice_answer', task_id: 'ur.letter_pick10', item_id: 'ur.letter_pick10.p2', at: at(3), data: { value: 'ت', ok: false, try: 2 } },
      { seq: 4, type: 'practice_answer', task_id: 'en.story_mcq_w3', item_id: 'en.story_mcq_w3.p1', at: at(4), data: { value: 2, ok: true, try: 1 } },
    ]);
    kept.forEach((e) => expect(JSON.stringify(e.data).length).toBeLessThanOrEqual(300));
  });

  test('more than 4 practice taps on one part in a batch: the first 4 are kept; another part keeps its own', async () => {
    const { deps, synced } = world(block);
    const events = [];
    for (let i = 0; i < 7; i++) events.push(tap(i + 1, 'ur.letter_pick10', `ur.letter_pick10.p${(i % 2) + 1}`, 'ب', false, (i % 2) + 1));
    events.push(tap(8, 'ma.number_id', 'ma.number_id.p1', '7', true, 1));
    await sa.saBatch({ userId: COACH, sessionId: SID, seqFrom: 1, seqTo: 8, events, results: [] }, deps);
    const kept = synced[0].events;
    expect(kept.filter((e) => e.task_id === 'ur.letter_pick10').map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(kept.filter((e) => e.task_id === 'ma.number_id').map((e) => e.seq)).toEqual([8]);
  });

  test('a practice value past the 300-character cap keeps the event with no data', async () => {
    const { deps, synced } = world(block);
    const events = [tap(1, 'en.dictation', 'en.dictation.p1', 'x'.repeat(400), false, 1)];
    await sa.saBatch({ userId: COACH, sessionId: SID, seqFrom: 1, seqTo: 1, events, results: [] }, deps);
    expect(synced[0].events).toEqual([{ seq: 1, type: 'practice_answer', task_id: 'en.dictation', item_id: 'en.dictation.p1', at: at(1), data: null }]);
  });
});
