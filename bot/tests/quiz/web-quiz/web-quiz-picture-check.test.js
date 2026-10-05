'use strict';
/**
 * A question picture a reviewer judged misleading is never shown on the web.
 *
 * media.picture_check records a review of the question's picture against its
 * stem and key: { verdict: 'fine' | 'contradicts' | 'ignores' | 'unreadable', by, at }.
 * On the page a picture judged `contradicts` (it pushes the child to a wrong
 * answer: the key says the cat slept, the picture shows it awake) or `ignores`
 * (it does not show what the question asks about) is left out:
 *  - a question that stands on its text plays text-only;
 *  - a question whose stem sends the child to the picture ("in the picture")
 *    is left out of the web quiz, like any picture question with no picture;
 *  - the media endpoint does not serve the picture either.
 * The WhatsApp quiz is untouched (it does not read picture_check).
 *
 * Supabase is the boundary and is faked; E2 and the media route run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../../shared/storage/r2', () => ({ getPresignedUrl: jest.fn(async (u) => u) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WQ = require('../../../shared/services/quiz/web-quiz.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const PIC = 'https://r2.example/quiz-question/cat.png';

function row(n, media, extra = {}) {
  return {
    id: qid(n), quiz_id: QUIZ, external_id: `leg:x:${n}`, sort_order: n,
    question_text: 'What did the cat do all day?', option_a: 'Slept', option_b: 'Ran', option_c: 'Sang', option_d: null,
    correct_option: 'A', explanation: 'The cat slept all day.', option_feedback: null, media, render_pattern: 'P3', ...extra,
  };
}

function seed(questions) {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Animals', language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Animals', grade: '2', subject: 'English', language: 'en', meta: {}, quiz_source: 'video' }],
    quiz_questions: questions,
    quiz_sessions: [], students: [], quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' }; delete process.env.WEB_QUIZ_TOKEN_SECRET; });
afterAll(() => { process.env = SAVED; });

const check = (verdict) => ({ verdict, by: 'review', at: '2026-10-05T22:00:00Z' });

describe('E2: a picture judged misleading is not shown', () => {
  test.each(['contradicts', 'ignores'])('verdict %s: the question plays text-only, no img', async (verdict) => {
    seed([row(1, { question_image: PIC, picture_check: check(verdict) })]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions).toHaveLength(1);
    expect(out.quiz.questions[0].img).toBeUndefined();
    expect(out.quiz.questions[0].figure).toBeUndefined();
    expect(out.quiz.questions[0].text).toMatch(/cat/);
  });

  test.each(['fine', 'unreadable'])('verdict %s: the picture is kept', async (verdict) => {
    seed([row(2, { question_image: PIC, picture_check: check(verdict) })]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions[0].img).toBeTruthy();
  });

  test('no review yet: the picture is kept', async () => {
    seed([row(3, { question_image: PIC })]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions[0].img).toBeTruthy();
  });

  test('a stem that sends the child to the hidden picture is left out of the web quiz', async () => {
    seed([
      row(4, { question_image: PIC, picture_check: check('contradicts') }, { question_text: 'Count the number of squares in the picture', option_a: '8', option_b: '9', option_c: '10' }),
      row(5, { question_image: PIC }),
    ]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions.map((q) => q.qid)).toEqual([qid(5)]);
  });

  test('a drawn figure the review judged misleading is not drawn either', async () => {
    seed([row(9, { figure: { type: 'count_objects', picto: 'apple', count: 5 }, question_image: PIC, picture_check: check('contradicts') },
      { question_text: 'How many apples are there?', option_a: '4', option_b: '5', option_c: '6', correct_option: 'B' })]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions[0].figure).toBeUndefined();
    expect(out.quiz.questions[0].img).toBeUndefined();
  });

  test('a hidden picture never falls back to the WhatsApp option collage', async () => {
    seed([row(6, { question_image: PIC, grid: 'https://r2.example/grid.png', picture_check: check('ignores') }, { render_pattern: 'P5' })]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions[0].img).toBeUndefined();
  });

  test('the media endpoint does not serve a hidden picture, and still serves a kept one', async () => {
    seed([row(7, { question_image: PIC, picture_check: check('contradicts') }), row(8, { question_image: PIC, picture_check: check('fine') })]);
    await expect(WQ.media('AB12CD', qid(7), { k: 'q' })).rejects.toMatchObject({ status: 404 });
    expect(await WQ.media('AB12CD', qid(8), { k: 'q' })).toEqual({ redirect: PIC });
  });
});
