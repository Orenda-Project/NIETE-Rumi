'use strict';
/**
 * bd-l9fr2 — a child who re-sends the class QUIZ code while their run is still open gets that run
 * back (its current question again), not a second, empty quiz_sessions row.
 *
 * Prod, 5 Oct outage: replies bounced, children re-sent the code, and 48 phones opened 84 sessions.
 * beginFromCodeLocked's join lock only dedups a re-send inside one minute; after that startSession
 * inserted a fresh `in_progress` row every time and overwrote the open run's Redis state.
 *
 * Mocked: supabase, Redis, WhatsApp, the logger, and the child engine's send/render seams.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/video-quiz-render.service', () => ({ build: jest.fn(() => ({})) }));
jest.mock('../../bot/shared/services/quiz/video-quiz-sender.service', () => ({
  sendPhase: jest.fn().mockResolvedValue({ sent: 1, failed: 0, pickerFailed: false }),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-rate-limiter.service', () => ({ throttle: jest.fn().mockResolvedValue(undefined) }));

const supabase = require('../../bot/shared/config/supabase');
const redis = require('../../bot/shared/services/cache/railway-redis.service');
const Sender = require('../../bot/shared/services/quiz/video-quiz-sender.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const vq = require('../../bot/shared/services/quiz/video-quiz.service');

const PHONE = '923009876543';
const QID = '11111111-1111-4111-8111-111111111111';
const OLD_SESS = '22222222-2222-4222-8222-222222222222';
const NEW_SESS = '55555555-5555-4555-8555-555555555555';
const SC = '33333333-3333-4333-8333-333333333333';
const KID = '66666666-6666-4666-8666-666666666666';

let inserts;
function stub() {
  inserts = [];
  supabase.from.mockImplementation((table) => {
    const list = { quiz_questions: [{ id: 'q-1', external_id: 'tq:S1:1', sort_order: 1 }, { id: 'q-2', external_id: 'tq:S1:2', sort_order: 2 }] }[table] || [];
    const one = {
      quizzes: { quiz_source: 'transcript' },
      quiz_sessions: { id: NEW_SESS },
      quiz_questions: { id: 'q-2', external_id: 'tq:S1:2', question_text: 'Two?', option_a: 'a', option_b: 'b', correct_option: 'a' },
    }[table] || null;
    const chain = {};
    ['select', 'eq', 'in', 'is', 'update', 'order', 'limit', 'neq', 'not'].forEach((m) => { chain[m] = () => chain; });
    chain.insert = (row) => { if (table === 'quiz_sessions') inserts.push(row); return chain; };
    chain.single = async () => ({ data: one, error: null });
    chain.maybeSingle = async () => ({ data: one, error: null });
    chain.then = (resolve, reject) => Promise.resolve({ data: list, error: null }).then(resolve, reject);
    return chain;
  });
  supabase.rpc.mockResolvedValue({ data: null, error: null });
}

/** The open run on this phone, one question answered, waiting on question 2. */
const openRun = (over = {}) => ({
  sessionId: OLD_SESS, quizId: QID, videoId: null, userId: null, language: 'en', source: 'share_link',
  shareCodeId: SC, studentId: KID, takerName: 'Ayesha',
  questionIds: ['q-1', 'q-2'], index: 1, correct: 1, answered: 1, currentQuestionId: 'q-2', ...over,
});
const withOpenRun = (state) => redis.get.mockImplementation(async (k) => (k === `videoquiz:${PHONE}:active` ? state : null));

const start = (over = {}) => vq.startSession({
  phone: PHONE, userId: null, quizId: QID, videoId: null, language: 'en',
  source: 'share_link', studentName: 'Ayesha', studentId: KID, shareCodeId: SC, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  redis.get.mockResolvedValue(null);
  stub();
});

describe('the same child re-sends the same class code while the run is open', () => {
  test('no new quiz_sessions row; the open run is returned', async () => {
    withOpenRun(openRun());
    const state = await start();
    expect(inserts).toHaveLength(0);
    expect(state).toEqual(expect.objectContaining({ sessionId: OLD_SESS, index: 1, answered: 1 }));
  });

  test('the current question is sent again, and the reuse is logged', async () => {
    withOpenRun(openRun());
    await start();
    expect(Sender.sendPhase).toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('video_quiz.session_reused', expect.objectContaining({ sessionId: OLD_SESS, quizId: QID }));
    expect(logEvent).not.toHaveBeenCalledWith('video_quiz.session_started', expect.anything());
  });
});

describe('anything else starts a new run, as before', () => {
  test.each([
    ['another quiz', { quizId: '99999999-9999-4999-8999-999999999999' }],
    ['another class link', { shareCodeId: '88888888-8888-4888-8888-888888888888' }],
    ['a sibling on the same phone', { studentId: '77777777-7777-4777-8777-777777777777' }],
  ])('%s open on the phone → a new session', async (_name, over) => {
    withOpenRun(openRun(over));
    await start();
    expect(inserts).toHaveLength(1);
  });

  test('no open run → a new session', async () => {
    await start();
    expect(inserts).toHaveLength(1);
  });

  test('a teacher\'s own solo run is never reused (video_solo)', async () => {
    withOpenRun(openRun({ source: 'video_solo' }));
    await start({ source: 'video_solo' });
    expect(inserts).toHaveLength(1);
  });
});
