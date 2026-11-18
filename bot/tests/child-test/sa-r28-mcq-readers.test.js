'use strict';

/**
 * Round 28 (sa_r28_mcq): a story MCQ part waits for its reading floor before it is banded. With the switch ON the MCQ
 * row is parked at sync and marked by the scorer once its passage's marks exist; until then (no marks, or marks
 * without gate_checked / stop_why) the ladder reads the part as pending and Results shows the oral's pending row
 * ("scored later"), never the phone's count that the floor may still zero. OFF: unchanged. Fixtures are synthetic.
 */

const level = require('../../shared/services/child-test/sa/level');
const sa = require('../../shared/services/child-test/app/sa-api.service');

const QS = [1, 2, 3, 4, 5, 6].map((n) => `ur.story_w3.q${n}`);
const result = (right) => ({ kind: 'result', task_id: 'ur.story_mcq_w3', mode: 'tap', attempted: 6, correct: right, incorrect: 6 - right, options_n: 4, of_all: 6, presented: 6, asked: QS, stop_reason: 'complete', scored_on: 'phone' });
const parked = (right) => ({ block: 'ur.story_mcq_w3', response_mode: 'tap', lang: 'ur', created_at: '2026-11-18T05:04:00Z', ai_status: 'failed', ai_reason: 'final:sa_score_later', ai_marks: null, responses: [result(right)] });
const gated = () => ({ ...parked(6), ai_status: 'scored', ai_reason: null,
  ai_marks: { version: 'sa-marks-v1', task: 'ur.story_mcq_w3', correct: 0, of: 6, tap_correct: 0, tap_attempted: 6, options_n: 4, chance_corrected: 0,
    detail: { kind: 'mcq', stopped_by_rule: true, stop_detail: 'comprehension', stop_why: 'first_line', gated: true, of_all: 6, of_asked: 0 } } });
const passed = (right) => ({ ...parked(right), ai_status: 'scored', ai_reason: null,
  ai_marks: { version: 'sa-marks-v1', task: 'ur.story_mcq_w3', correct: right, of: 6, tap_correct: right, tap_attempted: 6, options_n: 4,
    detail: { kind: 'mcq', stopped_by_rule: false, gate_checked: true, stop_why: null, of_all: 6, of_asked: 6 } } });
// a legacy row: synced by the store before the floor (phone marks at sync, no detail; marks are written once)
const syncMarked = (right) => ({ ...parked(right), ai_status: 'scored', ai_reason: null, ai_model_versions: { scorer: 'tap-v1' }, ai_marks: { tap_correct: right, tap_attempted: 6, options_n: 4, chance_corrected: right, stop_reason: 'complete' } });
// being scored now (the sweep's claim): still awaiting the floor
const claimed = (right) => ({ ...parked(right), ai_reason: 'final:sa_scoring:p1' });

const spoken = (block, marks) => ({ block, response_mode: 'record', lang: 'ur', ai_status: 'scored', ai_marks: marks, responses: [{ kind: 'result', mode: 'record', stop_reason: 'complete' }] });
const below = () => [spoken('ur.letter_names5', { correct: 5, attempted: 5 }), spoken('ur.words4', { correct: 4, attempted: 4 }), spoken('ur.story_w3', { correct: 30, attempted: 32 })];
const ITEMS = { 'ur.letter_names5': 5, 'ur.words4': 4, 'ur.story_mcq_w3': 6 };
const ur = (row, opts = {}) => level.levelsOf([...below(), row], [], { itemsOf: (id) => ITEMS[id] ?? null, ...opts }).find((x) => x.subject === 'ur');

describe('sa_r28_mcq ON: the ladder waits for the MCQ\'s reading floor (level.js)', () => {
  test('(7) a parked MCQ (no marks yet, the phone said 6/6) → the comprehension part pending, the level not raised', () => {
    expect(ur(parked(6), { mcqFloor: true })).toMatchObject({ level: 'story', pending: true });
  });
  test('(7) a legacy row marked from the phone at sync (no detail, never checked) → banded from the phone, not pending', () => {
    expect(ur(syncMarked(6), { mcqFloor: true })).toMatchObject({ level: 'comprehension', pending: false });
    expect(ur(syncMarked(3), { mcqFloor: true })).toMatchObject({ level: 'story', pending: false });
  });
  test('(7) a parked row being scored (claimed) → still pending', () => {
    expect(ur(claimed(6), { mcqFloor: true })).toMatchObject({ level: 'story', pending: true });
  });
  test('(7) the gated marks → unmet, the rung below, not pending', () => {
    expect(ur(gated(), { mcqFloor: true })).toMatchObject({ level: 'story', pending: false });
  });
  test('(7) checked and passed, 5 of 6 → comprehension', () => {
    expect(ur(passed(5), { mcqFloor: true })).toMatchObject({ level: 'comprehension', pending: false });
  });
  test('OFF: a parked-looking MCQ row is banded from the phone\'s count, as today', () => {
    expect(ur(parked(6))).toMatchObject({ level: 'comprehension', pending: false });
  });
});

describe('sa_r28_mcq ON: Results reads the oral\'s pending row until the floor is evaluated (sa-api.service.js)', () => {
  const SID = 'cccccccc-0000-4000-8000-0000000000b8';
  const COACH = 'aaaaaaaa-0000-4000-8000-0000000000b8';
  function world(blocks, extra = {}) {
    const session = { id: SID, coach_user_id: COACH, student_id: 'st-1', draw_id: 'd-1', school_id: 'sch-1', grade: 3, form: 'A',
      item_bank_version: 'sa-battery', status: 'completed', started_at: '2026-11-18T05:00:00Z', finished_at: '2026-11-18T05:20:00Z', device: { block: 'B1' } };
    return {
      enabled: async () => true, supabase: { from: () => { throw new Error('no direct reads'); } },
      store: { getSession: async (id) => ({ ok: true, session: id === SID ? session : null }), listBlocks: async (id) => ({ ok: true, blocks: id === SID ? blocks : [] }) },
      saStore: { findByClient: async () => ({ ok: true, sessionId: null }) }, bank: null, now: () => new Date('2026-11-18T06:00:00Z'), log: () => {},
      ...extra,
    };
  }
  const task = async (row, extra) => (await sa.saResults({ userId: COACH, sessionId: SID }, world([row], extra))).tasks[0];

  test('a parked MCQ → no count, "scored later" (the oral\'s pending form)', async () => {
    const t = await task(parked(6), { mcq: true });
    expect(t).toMatchObject({ correct: null, chanceCorrected: null, recording: 'scored_later', score: null });
  });
  test('the gated MCQ → 0, its own comprehension stop: not counted (the phone asked the questions; the floor withheld them)', async () => {
    const t = await task(gated(), { mcq: true, stopRules: true });
    expect(t).toMatchObject({ correct: 0, attempted: 6, chanceCorrected: 0, stopReason: 'comprehension_not_counted' });
  });
  test('the gated MCQ reads the not-counted stop row with the floor ON even when the stop rules are off', async () => {
    const t = await task(gated(), { mcq: true });
    expect(t).toMatchObject({ correct: 0, stopReason: 'comprehension_not_counted' });
  });
  test('the stop names the mode: the tapped row not counted, the oral questions in the same session not asked; the raw taps never leave the API', async () => {
    const oral = { block: 'ur.story_comp_w3', response_mode: 'oral', lang: 'ur', ai_status: 'scored', ai_reason: null, created_at: '2026-11-18T05:05:00Z',
      ai_marks: { version: 'sa-marks-v1', task: 'ur.story_comp_w3', correct: 0, of: 6, detail: { kind: 'questions', items: [], stopped_by_rule: true, stop_detail: 'comprehension', stop_why: 'first_line' } },
      responses: [{ kind: 'result', mode: 'oral', stop_reason: 'complete' }] };
    const tapped = gated();
    tapped.ai_marks.detail.raw = { tap_correct: 6, tap_attempted: 6, answers: QS.map((id) => ({ item_id: id, value: 1, ok: true })) };
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world([tapped, oral], { mcq: true, stopRules: true }));
    const by = Object.fromEntries(out.tasks.map((t) => [t.taskId, t]));
    expect(by['ur.story_mcq_w3']).toMatchObject({ mode: 'tap', correct: 0, attempted: 6, chanceCorrected: 0, stopReason: 'comprehension_not_counted' });
    expect(by['ur.story_comp_w3']).toMatchObject({ mode: 'oral', stopReason: 'comprehension_not_asked' });
    expect(JSON.stringify(by['ur.story_mcq_w3'])).not.toMatch(/answers|tap_correct|raw/);
  });
  test('a legacy row marked from the phone at sync → the scored row (the phone\'s count), not "scored later"', async () => {
    expect(await task(syncMarked(5), { mcq: true })).toMatchObject({ correct: 5, chanceCorrected: 5, recording: 'none' });
  });
  test('checked and passed → the phone\'s count', async () => {
    expect(await task(passed(5), { mcq: true })).toMatchObject({ correct: 5, recording: 'none' });
  });
  test('OFF: the parked-looking row shows the phone\'s count, as today', async () => {
    expect(await task(parked(6), { mcq: false })).toMatchObject({ correct: 6, recording: 'none' });
  });
});
