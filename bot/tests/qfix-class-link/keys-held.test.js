'use strict';
/**
 * Held answer keys never reach a child through the evening round:
 *   - a recall original whose key is held (the fixed list, or the key review's heldQuestionIds) never enters the pool;
 *   - the key quoted to the rewrite is the key the child was graded on (web-quiz-items keyFor: the web key), not
 *     correct_option;
 *   - a round's lesson item copied (cache hit) from a donor item whose key is held is marked 'held' and not served.
 * Faked boundaries: Supabase (in memory), Redis (a Map), the loggers; the key review module's heldQuestionIds.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false }));
jest.mock('../../shared/services/quiz/quiz-key-review.service', () => ({
  heldQuestionIds: jest.fn(async (db, ids) => new Set(ids.filter((id) => id === '99999999-0000-4000-8000-0000000000aa'))),
}));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const Keys = require('../../shared/services/quiz/quiz-key-review.service');
const Recall = require('../../shared/services/quiz/web-quiz-evening-round-recall');
const Round = require('../../shared/services/quiz/web-quiz-evening-round');

const C1 = 'c1a55000-0000-4000-8000-0000000000e1';
const T1 = '7e000000-0000-4000-8000-0000000000e1';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const FIXED = '4e15c1a5-244a-4c0e-800c-604462bc6324'; // on the fixed held list
const REVIEWED = '99999999-0000-4000-8000-0000000000aa'; // held by the key review
const FINE = '99999999-0000-4000-8000-0000000000bb';
const q = (id, text) => ({ id, quiz_id: 'qold', question_text: text, option_a: 'a', option_b: 'b', correct_option: 'A', sort_order: 1 });

function seed(over = {}) {
  const db = {
    quizzes: [{ id: 'qold', teacher_id: T1, subject: 'english', grade: '3', meta: { source: 'lp_offer' } }],
    quiz_share_codes: [{ id: 'scold', class_id: C1 }],
    quiz_sessions: [{ id: 's1', student_id: ZARA, quiz_id: 'qold', share_code_id: 'scold', completed_at: '2026-11-22T13:00:00Z' }],
    quiz_answers: [FIXED, REVIEWED, FINE].map((id, i) => ({ id: `a${i}`, session_id: 's1', question_id: id, is_correct: false })),
    quiz_questions: [q(FIXED, 'Fixed held?'), q(REVIEWED, 'Reviewed held?'), q(FINE, 'Fine?')],
    ...over,
  };
  Object.assign(supabase, { from: makeFake(db).from });
  return db;
}

test('a held original (the fixed list, or the key review) never enters the recall pool', async () => {
  seed();
  const got = await Recall.missesFor({ classId: C1, day: '2026-11-24', enrolled: [ZARA], teacherIds: [T1] });
  expect(got.map((m) => m.question.id)).toEqual([FINE]);
  expect(Keys.heldQuestionIds).toHaveBeenCalledWith(supabase, expect.arrayContaining([FIXED, REVIEWED, FINE]));
});

test('the rewrite is told the key the child was graded on (the web key), not correct_option', () => {
  const orig = {
    question: { id: FINE, question_text: 'Pick the two colours.', option_a: 'red', option_b: 'run', option_c: 'blue', correct_option: 'A',
      media: { web: { v: 2, type: 'multi', stem: 'Pick the two colours.', options: [{ slot: 'A' }, { slot: 'B' }, { slot: 'C' }], key: ['C', 'A'] } } },
    quiz: { subject: 'english', grade: '3' }, missedBy: [ZARA], n: 1,
  };
  const prompt = Recall.buildPrompt([orig], 'en');
  expect(prompt).toContain('"correct": "A,C"');
});

test('a lesson item copied from a donor item whose key is held is marked held and not served', async () => {
  const QID = 'q-round';
  const db = seed({
    quizzes: [{ id: QID, teacher_id: T1, subject: 'maths', grade: '3', language: 'en', status: 'generating',
      meta: { source: 'evening_round', class_id: C1, round_day: '2026-11-24', class_link_code: 'K7Q2MXTRAB', recall_src: [], cache_donor: { quiz_id: 'qdonor' } } }],
    quiz_share_codes: [],
    classes: [{ id: C1, grade_code: 'grade_3', section: 'B' }],
    quiz_questions: [
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `d${n}`, quiz_id: 'qdonor', external_id: `tq:x:S1:${n}`, question_text: `D${n}` })),
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `r${n}`, quiz_id: QID, external_id: `tq:x:S1:${n}`, sort_order: n, question_text: `L${n}`, correct_option: 'A', media: {} })),
    ],
  });
  db.quiz_questions.find((r) => r.id === 'd2').id = REVIEWED; // the donor's 2nd item is held
  const mintCode = jest.fn(async () => { db.quiz_share_codes.push({ id: 'sc-r', code: 'RND234', quiz_id: QID, class_id: C1 }); return { id: 'sc-r', code: 'RND234' }; });
  const out = await Round.afterGenerate({ quizId: QID }, { mintCode });
  expect(out).toMatchObject({ ok: true, round: true });
  const mine = db.quiz_questions.filter((r) => r.quiz_id === QID);
  expect(mine.find((r) => r.id === 'r2').media.round).toBe('held');
  const served = Round.selectRoundItems(mine, { studentId: ZARA }).map((r) => r.id);
  expect(served).toEqual(['r1', 'r3', 'r4', 'r5', 'r6']);
  expect(db.quizzes[0].meta).toMatchObject({ n_held: 1, n_lesson: 5 });
});
