'use strict';
/**
 * bd-v0toag.10 (c) — finish() asks "who helped?" (quiz-helped-by.offer) once the child's result
 * is out, with the quiz's own stream so offer() can keep it to lesson quizzes. The teacher's own
 * test run of the class link is not asked. Harness copied from quiz-funnel-children.test.js.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('m1') }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png')),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-render.service', () => ({ build: jest.fn(() => ({})) }));
jest.mock('../../bot/shared/services/quiz/video-quiz-sender.service', () => ({
  sendPhase: jest.fn().mockResolvedValue({ sent: 1, failed: 0, pickerFailed: false }),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-scorecard.service', () => ({ sendScorecard: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/services/quiz/video-quiz-rate-limiter.service', () => ({ throttle: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../bot/shared/services/student-video-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));

jest.mock('../../bot/shared/services/quiz/quiz-helped-by', () => ({ offer: jest.fn().mockResolvedValue(true) }));

const supabase = require('../../bot/shared/config/supabase');
const Helped = require('../../bot/shared/services/quiz/quiz-helped-by');
const vq = require('../../bot/shared/services/quiz/video-quiz.service');

const QID = '11111111-1111-4111-8111-111111111111';
const SESS = '22222222-2222-4222-8222-222222222222';
const TID = '44444444-4444-4444-8444-444444444444';
const QROW = { topic: 'Fractions', grade: '4', subject: 'maths', quiz_source: 'lp_v8', meta: {}, language: 'en' };

/** Per-table stub: awaited reads return lists, maybeSingle/single return one row. */
function stub({ quizRow = QROW, sessions = [], shareCode = null, teacher = null, answers = [{ question_id: 'q-1', is_correct: true }] } = {}) {
  supabase.from.mockImplementation((table) => {
    const list = {
      quiz_questions: [{ id: 'q-1', external_id: 'tq:S1:1', sort_order: 1 }],
      quiz_answers: answers,
      quiz_sessions: sessions,
    }[table] || [];
    const one = {
      quizzes: quizRow,
      quiz_sessions: { id: SESS },
      quiz_share_codes: shareCode,
      users: teacher,
    }[table] || null;
    const chain = {};
    ['select', 'eq', 'in', 'is', 'update', 'order', 'limit', 'insert', 'neq', 'not'].forEach((m) => { chain[m] = () => chain; });
    chain.single = async () => ({ data: one, error: null });
    chain.maybeSingle = async () => ({ data: one, error: null });
    chain.then = (resolve, reject) => Promise.resolve({ data: list, error: null }).then(resolve, reject);
    return chain;
  });
  supabase.rpc.mockResolvedValue({ data: null, error: null });
}

beforeEach(() => jest.clearAllMocks());

test('a child finishes → asked who helped, with the quiz stream, after the scorecard', async () => {
  stub();
  const state = { sessionId: SESS, quizId: QID, source: 'share_link', language: 'ur', questionIds: ['q-1'], answered: 1, correct: 1 };
  await vq.finish('923009876543', state);
  expect(Helped.offer).toHaveBeenCalledTimes(1);
  expect(Helped.offer).toHaveBeenCalledWith('923009876543', expect.objectContaining({ sessionId: SESS, language: 'ur' }), 'lp_v8');
});

test('the teacher\'s own test run of the class link → not asked', async () => {
  stub();
  await vq.finish('920000000000', {
    sessionId: SESS, quizId: QID, userId: TID, source: 'share_link', language: 'en', questionIds: ['q-1'], answered: 1, correct: 1,
  });
  expect(Helped.offer).not.toHaveBeenCalled();
});

test('a child who answered nothing is not scored and not asked', async () => {
  stub({ answers: [] });
  await vq.finish('923009876543', { sessionId: SESS, quizId: QID, source: 'share_link', language: 'en', questionIds: ['q-1'], answered: 0, correct: 0 });
  expect(Helped.offer).not.toHaveBeenCalled();
});
