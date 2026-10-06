'use strict';
/**
 * A question whose stem SUPPOSES a picture it does not carry is not served on the web.
 *
 * Earth's Layers Q8: "If a diagram shows four concentric circles representing Earth's layers, which
 * circle would represent the mantle?" was played with no diagram. The serve-time skip knew "look at
 * the picture" but not a picture the stem supposes ("if a diagram shows", "the image below"). It now
 * uses the authoring gate's presupposesPicture(stem), so old quizzes written before that gate are
 * covered too. The WhatsApp quiz is untouched.
 *
 * (Shared harness copied from web-quiz-picture-check.test.js.)
 * ORIGINAL HEADER: A question picture a reviewer judged misleading is never shown on the web.
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

const SUPPOSED = [
  'If a diagram shows four concentric circles representing Earth\'s layers, which circle would represent the mantle?',
  'The image below shows a plant. Which part is the root?',
];

describe('a stem that supposes a picture it does not carry', () => {
  test.each(SUPPOSED)('is not served without its picture: %s', async (stem) => {
    seed([row(1, {}), row(2, {}, { question_text: stem, external_id: 'tq:2' })]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions.map((q) => q.text)).not.toContain(stem);
    expect(out.quiz.questions).toHaveLength(1);
  });

  test('the same stem WITH its picture is served', async () => {
    seed([row(1, {}), row(2, { question_image: PIC }, { question_text: SUPPOSED[0], external_id: 'tq:2' })]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions.map((q) => q.text)).toContain(SUPPOSED[0]);
  });

  test('a plain stem that names no picture is served', async () => {
    seed([row(1, {}), row(2, {}, { question_text: 'Which layer of the Earth is on the outside?', external_id: 'tq:2' })]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions).toHaveLength(2);
  });
});
