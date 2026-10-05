'use strict';
/**
 * A WhatsApp match question on the web page is the page's own tap-to-match.
 *
 * On WhatsApp a match question is a drawing with lettered rows (cat, dog, cow) and
 * numbered partners (meow, woof, moo), and the options are codes for whole pairings
 * ("A-1, B-2, C-3"). On the page a child can link the pairs themselves, so the row is
 * served as a match item: each left tile shows its letter and its picture, the partners
 * (with their numbers, which the why still names) are the options, and the answer is the pairing the correct code names. The drawing
 * with its handles is not shown twice. Grading reads the same item. A row whose codes
 * do not decode into one full pairing is served as today. WhatsApp is unchanged.
 *
 * Supabase is the boundary and is faked; E2, the figure module and the grader run for real.
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

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const WebItems = require('../../../shared/services/quiz/web-quiz-items');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();

const SOUNDS = { type: 'match', left: ['cat', 'dog', 'cow'], right: ['meow', 'woof', 'moo'] };
function matchRow(n, extra = {}) {
  return {
    id: qid(n), quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n,
    question_text: 'Match A, B and C to the sound each animal makes.',
    option_a: 'A-2, B-1, C-3', option_b: 'A-1, B-2, C-3', option_c: 'A-3, B-2, C-1', option_d: null,
    correct_option: 'B', explanation: 'A cat says meow, a dog says woof and a cow says moo.', option_feedback: null,
    media: { figure: SOUNDS, language: 'en' }, render_pattern: 'P3', ...extra,
  };
}
const plain = (n) => ({ ...matchRow(n), question_text: 'How many legs does a cat have?', option_a: '2', option_b: '4', option_c: '6', media: { language: 'en' } });

function seed(questions) {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Animals', language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Animals', grade: '3', subject: 'English', language: 'en', meta: {}, quiz_source: 'transcript' }],
    quiz_questions: questions, quiz_sessions: [], students: [], quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' }; delete process.env.WEB_QUIZ_TOKEN_SECRET; });
afterAll(() => { process.env = SAVED; });

describe('E2: a WhatsApp-coded match question becomes the page tap-to-match', () => {
  test('left tiles carry their letter and a drawn picture; the partners are the options; the key is the pairing', async () => {
    seed([plain(1), matchRow(2)]);
    const q = (await WQ.getQuiz('AB12CD', {})).quiz.questions[1];
    expect(q.type).toBe('match');
    expect(q.left.map((l) => l.text)).toEqual(['P', 'Q', 'R']);
    expect(q.left.every((l) => l.pic && /<svg/.test(l.pic.svg))).toBe(true);
    expect(q.options.map((o) => o.text)).toEqual(['1. meow', '2. woof', '3. moo']);
    expect(q.options.map((o) => o.name)).toEqual(['meow', 'woof', 'moo']);
    expect(q.correct_slot).toBe('A,B,C');
    expect(q.text).toMatch(/P, Q and R/);
  });

  test('the drawing with its row handles and numbers is not shown as well', async () => {
    seed([plain(1), matchRow(2)]);
    const q = (await WQ.getQuiz('AB12CD', {})).quiz.questions[1];
    expect(q.figure).toBeUndefined();
  });

  test('grading reads the same pairing: cat-meow, dog-woof, cow-moo is right; any other is not', () => {
    const row = matchRow(2);
    expect(WebItems.isCorrect(row, 'A,B,C')).toBe(true);
    expect(WebItems.isCorrect(row, 'B,A,C')).toBe(false);
    expect(WebItems.isCorrect(row, 'B')).toBe(false);
  });

  test('a different correct code gives a different pairing', () => {
    const row = matchRow(3, { correct_option: 'C' }); // A-3, B-2, C-1
    expect(WebItems.keyFor(row)).toBe('C,B,A');
  });

  test('codes that are not one full pairing leave the question as today', async () => {
    seed([plain(1), matchRow(4, { option_b: 'A-1, B-1, C-3' })]);
    const q = (await WQ.getQuiz('AB12CD', {})).quiz.questions[1];
    expect(q.type).not.toBe('match');
    expect(q.figure).toBeTruthy();
  });

  test('a stored web item always wins over the decoded one', () => {
    const web = { v: 2, type: 'single', stem: 'x', options: [{ slot: 'A', text: 'a' }, { slot: 'B', text: 'b' }], key: 'B', why: 'y' };
    const row = matchRow(5, { media: { figure: SOUNDS, language: 'en', web } });
    expect(WebItems.keyFor(row)).toBe('B');
  });
});
