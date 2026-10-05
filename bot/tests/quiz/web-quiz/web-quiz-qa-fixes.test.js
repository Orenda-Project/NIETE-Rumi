'use strict';
/**
 * Fixes from the first end-to-end run of the web quiz on sandbox.
 *
 *   - E2 names the teacher exactly as the forwarded WhatsApp text does
 *     ("Teacher <full name>"), never a first word cut off the stored name.
 *   - E2 names the class with the heading the teacher's report uses for this
 *     code (the classes the finished children typed), or null when there is none.
 *   - The first web session of a quiz marks the quiz as the web arm, so the
 *     teacher's report counts each child's FIRST finish — the same rule the
 *     page's league table promises.
 *
 * Supabase, the SQS queue, Redis and the WhatsApp sender are the boundaries and
 * are faked; every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    get: jest.fn(async (k) => keys.get(k) || null),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockRejectedValue(new Error('no renderer in test env')),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const WhatsApp = require('../../../shared/services/whatsapp.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const report = require('../../../shared/services/quiz/video-quiz-report.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const KID_A = '44444444-4444-4444-8444-444444444444';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

let fake;
function seed({ teacherName = 'Ms Example Teacher', language = 'en', meta = {}, sessions } = {}) {
  fake = makeFake({
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: teacherName,
        topic: 'Parts of a plant', language, active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30), report_sent_at: null },
    ],
    users: [{ id: TEACHER, phone_number: '000', preferred_language: 'en' }],
    quizzes: [{ id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language, meta, quiz_source: 'transcript' }],
    quiz_questions: [1, 2].map((n) => ({
      id: `9999999${n}-9999-4999-8999-999999999999`, quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n,
      question_text: `Question ${n}`, option_a: 'Root', option_b: 'Leaf', option_c: null, option_d: null,
      correct_option: 'B', explanation: '', option_feedback: {}, media: {}, render_pattern: 'P1',
    })),
    quiz_sessions: sessions || [],
    students: [{ id: KID_A, student_name: 'Zara Example', self_reported_class: '3-B', phone: null }],
    quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const finished = (id, over) => ({
  id, quiz_id: QUIZ, share_code_id: SC, student_id: KID_A, student_name: 'Zara Example', student_class: '3-B',
  user_id: null, status: 'completed', invited_by_student_id: null, source: 'share_link', parent_phone: null, ...over,
});

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  redis.__keys.clear();
  jest.clearAllMocks();
});
afterAll(() => { process.env = SAVED; });

describe('E2 names the teacher as the forwarded WhatsApp text does', () => {
  test('the whole stored name, with the same "Teacher" word, never a cut-off first word', async () => {
    seed({ teacherName: 'Ms Example Teacher' });
    const out = await WQ.getQuiz('AB12CD');
    expect(out.cls.teacher).toBe('Teacher Ms Example Teacher');
  });

  test('Urdu quiz: the Urdu form; no stored name: "your teacher"', async () => {
    seed({ teacherName: 'Example', language: 'ur' });
    expect((await WQ.getQuiz('AB12CD')).cls.teacher).toBe('استاد Example');
    seed({ teacherName: null });
    expect((await WQ.getQuiz('AB12CD')).cls.teacher).toBe('Your teacher');
  });
});

