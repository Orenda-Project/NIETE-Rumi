'use strict';
/**
 * bd-v0toag.9 / .10 — quizReport's v21 extras sit behind app_settings `quiz_slo_retest_enabled`.
 * Off (no row): the report is exactly as before — no attempts, no completion, no code.
 * On: each played child carries its number of tries, the summary carries completion
 * (finished ÷ started), and a question whose S-id has a stored SLO code carries it.
 * Supabase is the faked boundary.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const Q = (n) => `c0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

const session = (id, studentId, name, correct, h, extra = {}) => ({
  id, quiz_id: QUIZ, share_code_id: SC, student_id: studentId, student_name: name, user_id: null,
  status: 'completed', correct_answers: correct, total_questions_answered: 2,
  completed_at: ago(h), created_at: ago(h + 0.1), invited_by_student_id: null, device_ref: `dev-${id}`, ...extra,
});

function seed({ flag } = {}) {
  const fake = makeFake({
    app_settings: flag === undefined ? [] : [{ key: 'quiz_slo_retest_enabled', value: flag }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en',
      quiz_source: 'lp_v8', status: 'sent', list_id: null, created_at: ago(30),
      meta: { share_code_id: SC, slo_codes: { S1: 'S-03-PL-01' }, slo_code_status: 'one_code' } }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, invited_by_student_id: null, created_at: ago(30) }],
    quiz_sessions: [
      session('s1a', kid(1), 'Amna Testwala', 0, 21, { status: 'incomplete', completed_at: null }),
      session('s1', kid(1), 'Amna Testwala', 2, 20),
      session('s2', kid(2), 'Bilal Testwala', 1, 19),
      session('s3', kid(3), 'Chand Testwala', 0, 16, { status: 'in_progress', completed_at: null }),
    ],
    quiz_questions: [
      { id: Q(1), quiz_id: QUIZ, external_id: `tq:${QUIZ}:S1:1`, sort_order: 1, question_text: 'Q1?', option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_option: 'A' },
      { id: Q(2), quiz_id: QUIZ, external_id: `tq:${QUIZ}:S2:1`, sort_order: 2, question_text: 'Q2?', option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_option: 'A' },
    ],
    quiz_answers: [],
  });
  Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
  return fake;
}

let Data;
beforeEach(() => {
  jest.resetModules();
  Data = require('../../../shared/services/quiz/teacher-report.data');
});

test('switch off: no tries, no completion, no code — the report is unchanged', async () => {
  seed();
  const r = await Data.quizReport(TEACHER, QUIZ);
  expect(r.summary.completion).toBeUndefined();
  r.played.forEach((p) => expect(p).not.toHaveProperty('attempts'));
  r.questions.forEach((q) => expect(q).not.toHaveProperty('code'));
});

test('switch on: tries per child, completion beside score, SLO code on the coded question only', async () => {
  seed({ flag: true });
  const r = await Data.quizReport(TEACHER, QUIZ);
  const byName = Object.fromEntries(r.played.map((p) => [p.first, p.attempts]));
  expect(byName).toEqual({ Amna: 2, Bilal: 1 });
  expect(r.summary.completion).toEqual({ started: 3, finished: 2, pct: 67 });
  expect(r.questions.map((q) => q.code)).toEqual(['S-03-PL-01', undefined]);
});
