'use strict';
/**
 * A cache hit copies a donor quiz's rows into the round. A donor item whose key the donor's blind solve flagged and
 * its fix path REWROTE is a review candidate, not a fix (PLAN §11 A33): the round holds the copy and queues the
 * DONOR's row under blind_solve (the item children answered, with their counts), unless a person has already
 * reviewed it. The donor's record names the item by its authored index; the stored row is found past the solve's own
 * drops and the answer-leak drops.
 * Faked boundaries: Supabase (in memory, with the queue's unique key), Redis off, the loggers.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const Round = require('../../shared/services/quiz/web-quiz-evening-round');

const C1 = 'c1a55000-0000-4000-8000-0000000000c1';
const T1 = '7e000000-0000-4000-8000-0000000000c1';
const ZARA = 'c0000001-0000-4000-8000-0000000000c1';
const QID = '44444444-4444-4444-8444-0000000000c1';
const DONOR = '44444444-4444-4444-8444-0000000000c2';
const d = (i) => `0d000000-0000-4000-8000-00000000000${i}`;

function seed({ reviews = [] } = {}) {
  const db = {
    quizzes: [
      { id: QID, teacher_id: T1, subject: 'urdu', grade: '2', language: 'ur', status: 'ready',
        meta: { source: 'evening_round', class_id: C1, round_day: '2026-11-24', class_link_code: 'K7Q2MXTRAB', recall_src: [], cache_donor: { quiz_id: DONOR } } },
      // Authored 8; the solve rewrote item 3 and dropped item 1; the leak repair then dropped item 0 of the 7 left.
      // Item 3 is stored at position 3 - 1 (the solve's drop before it) - 1 (the leak drop before it) = 1.
      { id: DONOR, teacher_id: T1, quiz_source: 'lp_v8', status: 'sent', language: 'ur',
        meta: { key_verify: { status: 'fixed', checked: 8, fixed: 1, dropped: 1, disagreements: [{ index: 1, outcome: 'dropped' }, { index: 3, outcome: 'fixed' }] },
          answer_leaks: { dropped: [0] }, question_count: 6 } },
    ],
    quiz_share_codes: [],
    classes: [{ id: C1, grade_code: 'grade_2', section: 'B' }],
    quiz_questions: [
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ id: d(i), quiz_id: DONOR, external_id: `tq:${DONOR}:S1:${i + 1}`, sort_order: i, question_text: `D${i}`,
        option_a: 'x', option_b: 'y', option_c: 'z', correct_option: 'B', media: {} })),
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, quiz_id: QID, external_id: `tq:${QID}:S1:${i + 1}`, sort_order: i, question_text: `D${i}`,
        option_a: 'x', option_b: 'y', option_c: 'z', correct_option: 'B', media: {} })),
    ],
    // the donor item's child answers: B (the key) 3, C 2, A 1
    quiz_answers: ['B', 'B', 'B', 'C', 'C', 'A'].map((o, n) => ({ id: `a${n}`, session_id: `s${n}`, question_id: d(1), selected_option: o })),
    quiz_item_reviews: reviews,
  };
  Object.assign(supabase, { from: makeFake(db, { uniques: { quiz_item_reviews: ['question_id', 'reason'] } }).from });
  const mintCode = jest.fn(async () => { db.quiz_share_codes.push({ id: 'sc-c', code: 'RNDC12', quiz_id: QID, class_id: C1 }); return { id: 'sc-c', code: 'RNDC12' }; });
  return { db, mintCode };
}

beforeEach(() => jest.clearAllMocks());
const mine = (db) => db.quiz_questions.filter((r) => r.quiz_id === QID);

test('a copy of a donor item the fix path rewrote is held; the donor row is queued with its child answers', async () => {
  const { db, mintCode } = seed();
  await Round.afterGenerate({ quizId: QID }, { mintCode });
  expect(mine(db).find((r) => r.id === 'r1').media.round).toBe('held');
  expect(Round.selectRoundItems(mine(db), { studentId: ZARA }).map((r) => r.id)).toEqual(['r0', 'r2', 'r3', 'r4', 'r5']);
  expect(db.quiz_item_reviews).toHaveLength(1);
  expect(db.quiz_item_reviews[0]).toMatchObject({
    question_id: d(1), reason: 'blind_solve', status: 'open', key_at_flag: 'B', top_wrong_option: null, answers_n: 6, right_n: 3, top_wrong_n: 2,
  });
  expect(db.quizzes[0].meta).toMatchObject({ n_dropped: 1, n_held: 0, n_lesson: 5 });
  expect(logEvent).toHaveBeenCalledWith('web_quiz.round_written', expect.objectContaining({ n_dropped: 1 }));
});

test('a redelivered job queues nothing twice and still holds the copy', async () => {
  const { db, mintCode } = seed();
  await Round.afterGenerate({ quizId: QID }, { mintCode });
  await Round.afterGenerate({ quizId: QID }, { mintCode });
  expect(db.quiz_item_reviews).toHaveLength(1);
  expect(mine(db).find((r) => r.id === 'r1').media.round).toBe('held');
  expect(db.quizzes[0].meta).toMatchObject({ n_dropped: 1, n_held: 0 });
});

test('a donor item a person has already reviewed (key_ok) is served, and its review row is left as it is', async () => {
  const reviewed = { id: 'rev1', question_id: d(1), reason: 'blind_solve', status: 'key_ok', key_at_flag: 'B', reviewed_at: '2026-11-22T11:48:00Z', answers_n: 0, top_wrong_n: 0, right_n: 0 };
  const { db, mintCode } = seed({ reviews: [{ ...reviewed }] });
  await Round.afterGenerate({ quizId: QID }, { mintCode });
  expect(mine(db).find((r) => r.id === 'r1').media.round).toBe('lesson');
  expect(db.quiz_item_reviews).toEqual([reviewed]);
  expect(db.quizzes[0].meta).toMatchObject({ n_dropped: 0, n_lesson: 6 });
});
