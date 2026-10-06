'use strict';
/**
 * A live word_blank that is not the question asked is not served on the web (gates v2).
 *
 * 318 of 392 production word_blank items hide a letter of a word the question treats as whole
 * («کتاب» syllables over «ک _ ا ب») or hold a whole sentence; they are already sent and live.
 * With app_settings quiz_author_gates_v2 on, the WEB page reads them like this, at serve time:
 *  - the stem stands on its own → the item plays as text, without the picture;
 *  - the stem needs the picture ("in the picture…") → the item is left out;
 *  - never below 3 playable items: then the quiz plays as today, logged web_quiz.word_blank_kept;
 *  - one log line per quiz with the ids hidden or shown as text (ids only).
 * A word_blank whose key IS its hidden letter is untouched. Gates off: today exactly. WhatsApp is not
 * touched by this (it does not call loadQuestions).
 *
 * (Harness copied from web-quiz-picture-supposed.test.js.) Supabase is the boundary and is faked.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const { logEvent } = require('../../../shared/utils/structured-logger');
const GatesV2 = require('../../../shared/services/quiz/quiz-author-gates-v2');
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


const SYLLABLES = { question_text: "تصویر میں دیے گئے لفظ 'کتاب' کے کتنے ارکان ہیں؟", option_a: 'ایک', option_b: 'دو', option_c: 'تین', correct_option: 'B', explanation: 'کِ اور تاب۔' };
const SELF = { question_text: "لفظ 'کتاب' کے کتنے ارکان ہیں؟", option_a: 'ایک', option_b: 'دو', option_c: 'تین', correct_option: 'B', explanation: 'کِ اور تاب۔' };
const LETTER = { question_text: 'تصویر میں خالی جگہ پر کون سا حرف آئے گا؟', option_a: 'ک', option_b: 'ت', option_c: 'ب', correct_option: 'B', explanation: 'کتاب' };
const WB = { language: 'ur', figure: { type: 'word_blank', word: 'کتاب', blanks: [1] } };
const plain = (n) => row(n, {});
const wb = (n, over) => row(n, WB, { ...over, external_id: `tq:${n}` });

afterEach(() => { GatesV2.resetForTests(); logEvent.mockClear(); });

describe('gates on', () => {
  beforeEach(() => GatesV2.setEnabled(true));

  test('a stem that needs the picture is left out, logged by id', async () => {
    seed([plain(1), plain(2), plain(3), wb(4, SYLLABLES)]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions.map((q) => q.qid)).toEqual([qid(1), qid(2), qid(3)]);
    const ev = logEvent.mock.calls.find((c) => c[0] === 'web_quiz.word_blank_hidden');
    expect(ev && ev[1]).toMatchObject({ hidden: [qid(4)], text_only: [] });
  });

  test('a stem that stands on its own plays as text, without the picture', async () => {
    seed([plain(1), plain(2), wb(3, SELF)]);
    const out = await WQ.getQuiz('AB12CD', {});
    const q = out.quiz.questions.find((x) => x.qid === qid(3));
    expect(q).toBeTruthy();
    expect(q.figure).toBeUndefined();
    expect(q.img).toBeUndefined();
  });

  test('a word_blank keyed to its hidden letter keeps its picture', async () => {
    seed([plain(1), plain(2), wb(3, LETTER)]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions.find((x) => x.qid === qid(3)).figure).toBeTruthy();
  });

  test('never below 3 playable items: the quiz plays as today, logged', async () => {
    seed([plain(1), plain(2), wb(3, SYLLABLES)]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions).toHaveLength(3);
    expect(logEvent.mock.calls.some((c) => c[0] === 'web_quiz.word_blank_kept')).toBe(true);
  });
});

test('gates off: served exactly as today', async () => {
  GatesV2.setEnabled(false);
  seed([plain(1), plain(2), plain(3), wb(4, SYLLABLES)]);
  const out = await WQ.getQuiz('AB12CD', {});
  expect(out.quiz.questions).toHaveLength(4);
  expect(out.quiz.questions[3].figure).toBeTruthy();
});
