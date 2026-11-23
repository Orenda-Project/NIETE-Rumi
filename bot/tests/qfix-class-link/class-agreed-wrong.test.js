'use strict';
/**
 * A class that agrees on one "wrong" answer holds the original out of the recall pool (lead idea 20261122T121624).
 * Before an original the class missed enters the pool, keys' own rule (quiz-key-review.service suspectOf) runs on the
 * CLASS's answers to it, counted by stored option slot: at least 5 answers (a class, not the city) and one wrong
 * option drawing at least 60% of ALL of them. Such an original is queued for review (dominant_wrong_option, open,
 * the class's counts), kept out of the pool, and the round takes the next miss. A person's verdict is never
 * overwritten: an original already reviewed (key_ok) enters the pool. n_recall_held reaches the round's row,
 * round_written and round_shown.
 * Faked boundaries: Supabase (in memory, with the queue's unique key), Redis off, the loggers. Fictional children.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const Recall = require('../../shared/services/quiz/web-quiz-evening-round-recall');
const Round = require('../../shared/services/quiz/web-quiz-evening-round');

const C1 = 'c1a55000-0000-4000-8000-0000000000b1';
const T1 = '7e000000-0000-4000-8000-0000000000b1';
const KIDS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `c0000001-0000-4000-8000-0000000000b${n}`);
const X = '99999999-0000-4000-8000-0000000000b1'; // key A; 6 of 8 answers on C: the class agrees on one wrong answer
const Y = '99999999-0000-4000-8000-0000000000b2'; // key A; 4 right, 2 B, 2 C: an ordinary miss
const Z = '99999999-0000-4000-8000-0000000000b3'; // key B; 5 right, 3 A
const PICKS = {
  [X]: ['C', 'C', 'C', 'C', 'C', 'C', 'A', 'B'],
  [Y]: ['A', 'A', 'A', 'A', 'B', 'B', 'C', 'C'],
  [Z]: ['B', 'B', 'B', 'B', 'B', 'A', 'A', 'A'],
};
const KEY = { [X]: 'A', [Y]: 'A', [Z]: 'B' };
const q = (id, text) => ({ id, quiz_id: 'qold', question_text: text, option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_option: KEY[id], sort_order: 1, media: null });

function seed({ reviews = [], picks = PICKS, maxRows = {} } = {}) {
  const db = {
    quizzes: [{ id: 'qold', teacher_id: T1, subject: 'english', grade: '3', meta: { source: 'lp_offer' } }],
    quiz_share_codes: [{ id: 'scold', class_id: C1 }],
    quiz_sessions: KIDS.map((k, i) => ({ id: `s${i}`, student_id: k, quiz_id: 'qold', share_code_id: 'scold', completed_at: '2026-11-22T13:00:00Z' })),
    quiz_answers: Object.entries(picks).flatMap(([qid, ps]) => ps.map((o, i) => ({
      id: `a-${qid.slice(-2)}-${i}`, session_id: `s${i}`, question_id: qid, selected_option: o, is_correct: o === KEY[qid],
    }))),
    quiz_questions: [q(X, 'X?'), q(Y, 'Y?'), q(Z, 'Z?')],
    quiz_item_reviews: reviews,
  };
  Object.assign(supabase, { from: makeFake(db, { uniques: { quiz_item_reviews: ['question_id', 'reason'] }, maxRows }).from });
  return db;
}
const misses = () => Recall.missesFor({ classId: C1, day: '2026-11-24', enrolled: KIDS, teacherIds: [T1] });

beforeEach(() => jest.clearAllMocks());

test('the class agrees on one wrong answer: the original is queued and held out; the round takes the next misses', async () => {
  const db = seed();
  const got = await misses();
  expect(got.map((m) => m.question.id)).toEqual([Y, Z]);
  expect(got.held).toBe(1);
  expect(db.quiz_item_reviews).toHaveLength(1);
  expect(db.quiz_item_reviews[0]).toMatchObject({
    question_id: X, reason: 'dominant_wrong_option', status: 'open', key_at_flag: 'A', top_wrong_option: 'C', answers_n: 8, top_wrong_n: 6, right_n: 1,
  });
});

test('the class\'s answers are all read, past PostgREST\'s 1000-row page', async () => {
  const db = seed({ maxRows: { quiz_answers: 1000 } });
  // 1000 other answers of the same sessions that sort first: without paging, X, Y and Z's answers are never read
  for (let i = 0; i < 1000; i += 1) db.quiz_answers.push({ id: `0-${String(i).padStart(4, '0')}`, session_id: `s${i % 8}`, question_id: 'other', selected_option: 'A', is_correct: true });
  const got = await misses();
  expect(got.map((m) => m.question.id)).toEqual([Y, Z]);
  expect(db.quiz_item_reviews.map((r) => r.question_id)).toEqual([X]);
});

test('a class with fewer than 5 answers to an item is not enough to hold it', async () => {
  const db = seed({ picks: { [X]: ['C', 'C', 'C', 'C'], [Y]: PICKS[Y] } });
  const got = await misses();
  expect(got.map((m) => m.question.id)).toEqual([X, Y]);
  expect(got.held).toBe(0);
  expect(db.quiz_item_reviews).toHaveLength(0);
});

test('an original a person already reviewed (key_ok) enters the pool, its review row untouched', async () => {
  const reviewed = { id: 'rv1', question_id: X, reason: 'dominant_wrong_option', status: 'key_ok', key_at_flag: 'A', top_wrong_option: 'C', answers_n: 40, top_wrong_n: 30, right_n: 8, reviewed_at: '2026-11-22T11:48:00Z' };
  const db = seed({ reviews: [{ ...reviewed }] });
  const got = await misses();
  expect(got.map((m) => m.question.id)).toEqual([X, Y, Z]);
  expect(db.quiz_item_reviews).toEqual([reviewed]);
});

test('idempotent: the next tick queues nothing twice', async () => {
  const db = seed();
  await misses();
  await misses();
  expect(db.quiz_item_reviews).toHaveLength(1);
});

test('n_recall_held from the round\'s row reaches round_written', async () => {
  const db = seed();
  const QID = '44444444-4444-4444-8444-0000000000b1';
  db.quizzes.push({ id: QID, teacher_id: T1, subject: 'english', grade: '3', language: 'en', status: 'ready',
    meta: { source: 'evening_round', class_id: C1, round_day: '2026-11-24', class_link_code: 'K7Q2MXTRAB', recall_src: [], n_recall_held: 1 } });
  db.classes = [{ id: C1, grade_code: 'grade_3', section: 'B' }];
  const mintCode = jest.fn(async () => { db.quiz_share_codes.push({ id: 'sc-b', code: 'RNDB12', quiz_id: QID, class_id: C1 }); return { id: 'sc-b', code: 'RNDB12' }; });
  await Round.afterGenerate({ quizId: QID }, { mintCode });
  expect(logEvent).toHaveBeenCalledWith('web_quiz.round_written', expect.objectContaining({ n_recall_held: 1 }));
});
