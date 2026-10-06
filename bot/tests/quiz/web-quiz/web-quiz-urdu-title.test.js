'use strict';
/**
 * An Urdu quiz's page opens on an Urdu title.
 *
 * A lesson-plan quiz is labelled with the lesson's catalog name, verbatim —
 * English or Roman Urdu ("Understanding Dialogue") — and that is what an Urdu
 * page showed. With quiz_author_gates_v2 on, the digest writes `title_ur` once,
 * with the quiz; the page shows it on an Urdu code. A quiz written before it,
 * and every English code, keep the title they had.
 *
 * Supabase and the model are the boundaries and are faked; the E2 service and
 * the digest prompt run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/storage/r2', () => ({ getPresignedUrl: jest.fn(async (u) => `${u}?signed`) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const LpDigest = require('../../../shared/services/quiz/lp-quiz-digest.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const Q = {
  id: '99999991-9999-4999-8999-999999999999', quiz_id: QUIZ, external_id: 'tq:1', sort_order: 1,
  question_text: 'مکالمے میں کون بات کر رہا ہے؟', option_a: 'دو دوست', option_b: 'ایک استاد', option_c: 'ایک دکان دار', option_d: null,
  correct_option: 'A', explanation: 'مکالمہ دو دوستوں کی بات چیت ہے۔', option_feedback: null, render_pattern: 'P1', media: { language: 'ur' },
};
function wire({ lang = 'ur', meta = {} } = {}) {
  const fake = makeFake({
    quiz_share_codes: [{ id: '33333333-3333-4333-8333-333333333333', code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Understanding Dialogue', language: lang, active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Understanding Dialogue', grade: '2', subject: 'urdu', language: lang, meta, quiz_source: 'lp_v8' }],
    quiz_questions: [Q], quiz_sessions: [], students: [], quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
beforeEach(() => {
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
});

describe('the page', () => {
  test('an Urdu code shows the quiz\'s own Urdu title', async () => {
    wire({ meta: { digest: { topic: 'Understanding Dialogue', title_ur: 'مکالمہ سمجھنا' } } });
    expect((await WQ.getQuiz('AB12CD')).quiz.topic).toBe('مکالمہ سمجھنا');
  });
  test('a quiz written before it keeps its title', async () => {
    wire({ meta: { digest: { topic: 'Understanding Dialogue' } } });
    expect((await WQ.getQuiz('AB12CD')).quiz.topic).toBe('Understanding Dialogue');
  });
  test('an English code keeps the English title', async () => {
    wire({ lang: 'en', meta: { digest: { title_ur: 'مکالمہ سمجھنا' } } });
    expect((await WQ.getQuiz('AB12CD')).quiz.topic).toBe('Understanding Dialogue');
  });
  test('a "title" in Roman Urdu is not an Urdu title', async () => {
    wire({ meta: { digest: { title_ur: 'Mukalma Samajhna' } } });
    expect((await WQ.getQuiz('AB12CD')).quiz.topic).toBe('Understanding Dialogue');
  });
});

describe('the digest asks for it once, only for an Urdu quiz with the gates on', () => {
  const SLIDES = { meta: { lessonId: 'x', grade: '2', subject: 'urdu' }, slides: [{ title: 'Dialogue', body: 'Two friends talk about a meeting.' }] };
  test('gates on, Urdu: the prompt asks for "title_ur"', () => {
    expect(LpDigest.buildLpDigestPrompt({ slideScript: SLIDES, language: 'ur', grade: '2', subject: 'urdu', authorGates: true })).toMatch(/"title_ur"/);
  });
  test('gates off, or an English quiz: the prompt is as before', () => {
    expect(LpDigest.buildLpDigestPrompt({ slideScript: SLIDES, language: 'ur', grade: '2', subject: 'urdu', authorGates: false })).not.toMatch(/title_ur/);
    expect(LpDigest.buildLpDigestPrompt({ slideScript: SLIDES, language: 'en', grade: '2', subject: 'urdu', authorGates: true })).not.toMatch(/title_ur/);
  });
});
