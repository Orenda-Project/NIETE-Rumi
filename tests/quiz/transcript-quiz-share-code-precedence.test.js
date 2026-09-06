/**
 * bd-mg9c7.97 — a QUIZ-<code> text must reach the share-code join even when a
 * quiz state is already set on the handset (a post-quiz chat state, or an
 * active/invited session from an earlier quiz).
 *
 * Before this fix the QUIZ STATE INTERCEPT ran first in the handler, so a
 * child who had just finished one quiz (or had a stale active session) and
 * then tapped a SECOND teacher's forwarded link had their `QUIZ-ABC123` body
 * swallowed by `handlePostQuizChat` or the "tap an answer button" nudge —
 * they never joined the new quiz.
 *
 * This suite drives the real `handleTextMessage`, mocking only the network
 * boundary (supabase, redis, whatsapp, the quiz-session/video-quiz-share
 * service methods) — same harness pattern as tests/quiz/student-mode-gate.test.js.
 */

// Bot-only packages, mocked virtually — CI runs the root suite before `bot/ npm ci`,
// and a module-scope require of one kills the whole suite FILE.
jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn(),
  rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  auth: {},
}));

jest.mock('../../bot/shared/services/openai.service', () => ({
  getResponseWithFormat: jest.fn().mockResolvedValue('a warm answer'),
  detectIntent: jest.fn().mockResolvedValue({ type: 'general' }),
  generateResponse: jest.fn().mockResolvedValue('ok'),
}));

const mockSendMessage = jest.fn().mockResolvedValue(undefined);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendTypingIndicator: jest.fn(),
  markAsRead: jest.fn(),
  sendInteractiveMessage: jest.fn().mockResolvedValue(undefined),
  sendFlow: jest.fn().mockResolvedValue(undefined),
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
}));

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() },
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  setNX: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(undefined),
}));

// The join itself is mocked; parseShareCode is the REAL implementation so the
// pattern under test is the shipped one (root rule 6 / COMMON rule 2).
const mockBeginFromCodeLocked = jest.fn().mockResolvedValue(true);
const mockConsumeJoinReply = jest.fn().mockResolvedValue(false);
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  parseShareCode: jest.requireActual('../../bot/shared/services/quiz/video-quiz-share.service').parseShareCode,
  beginFromCodeLocked: (...a) => mockBeginFromCodeLocked(...a),
  consumeJoinReply: (...a) => mockConsumeJoinReply(...a),
}));

const mockGetPostQuizState = jest.fn().mockResolvedValue(null);
const mockEndPostQuizChat = jest.fn();
const mockHandlePostQuizChat = jest.fn();
const mockGetActiveState = jest.fn().mockResolvedValue(null);
const mockHandleAnswer = jest.fn().mockResolvedValue(undefined);
jest.mock('../../bot/shared/services/quiz/quiz-session.service', () => ({
  getPostQuizState: (...a) => mockGetPostQuizState(...a),
  endPostQuizChat: (...a) => mockEndPostQuizChat(...a),
  handlePostQuizChat: (...a) => mockHandlePostQuizChat(...a),
  getActiveState: (...a) => mockGetActiveState(...a),
  handleAnswer: (...a) => mockHandleAnswer(...a),
  startQuizFromInvite: jest.fn(),
  endSession: jest.fn(),
}));

jest.mock('../../bot/shared/services/training/capstone-delivery.service', () => ({
  routeTextAnswer: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../bot/shared/services/lp-context.service', () => ({
  injectLpContext: jest.fn(async ({ existingContext }) => existingContext || null),
  buildLpContext: jest.fn().mockResolvedValue({ entries: [] }),
  deliveryHint: () => '',
}));
jest.mock('../../bot/shared/services/lp612-edit-router.service', () => ({
  maybeHandleLp612Reply: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(async () => global.__TEST_USER__),
  getOrCreateSession: jest.fn().mockResolvedValue('sess-1'),
  updateSessionType: jest.fn(),
  storeConversation: jest.fn(),
  storeLessonPlan: jest.fn(),
  getConversationHistory: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const CHILD_PHONE = '923001110000';
const CHILD_USER = {
  id: 'u-child', phone_number: CHILD_PHONE, first_name: null,
  preferred_language: 'en', registration_completed: false, registration_state: null,
};

let handler;
function load() {
  jest.resetModules();
  handler = require('../../bot/shared/handlers/text-message.handler');
}

async function run(from, body, user) {
  global.__TEST_USER__ = user;
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, from, body, user);
  } catch (_) { /* branches below the intercepts reach services this suite does not stub */ }
  // The share-code join is dispatched with setImmediate so the webhook can
  // answer Meta in milliseconds. Let that turn of the loop run before asserting.
  await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPostQuizState.mockResolvedValue(null);
  mockGetActiveState.mockResolvedValue(null);
  mockBeginFromCodeLocked.mockResolvedValue(true);
  mockConsumeJoinReply.mockResolvedValue(false);
  load();
});

describe('bd-mg9c7.97 — QUIZ-<code> reaches the share-code join ahead of a stale quiz state', () => {
  test('1: a post-quiz chat state is set, body is QUIZ-ABC123 -> the join wins, not the post-quiz nudge', async () => {
    mockGetPostQuizState.mockResolvedValue({ studentName: 'Zara', topic: 'Fractions' });

    await run(CHILD_PHONE, 'QUIZ-ABC123', CHILD_USER);

    expect(mockBeginFromCodeLocked).toHaveBeenCalledWith(CHILD_PHONE, 'ABC123');
    expect(mockHandlePostQuizChat).not.toHaveBeenCalled();
  });

  test('2: an active quiz session is set, body is QUIZ-ABC123 -> the join wins, not the answer-button nudge', async () => {
    mockGetActiveState.mockResolvedValue({ currentQuestionId: 'q1' });

    await run(CHILD_PHONE, 'QUIZ-ABC123', CHILD_USER);

    expect(mockBeginFromCodeLocked).toHaveBeenCalledWith(CHILD_PHONE, 'ABC123');
    expect(mockHandleAnswer).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      CHILD_PHONE,
      expect.stringContaining('Tap one of the answer buttons')
    );
  });

  test('3a regression: post-quiz state set, body "stop" -> endPostQuizChat runs, the join is never invoked', async () => {
    mockGetPostQuizState.mockResolvedValue({ studentName: 'Zara', topic: 'Fractions' });

    await run(CHILD_PHONE, 'stop', CHILD_USER);

    expect(mockEndPostQuizChat).toHaveBeenCalledWith(CHILD_PHONE);
    expect(mockBeginFromCodeLocked).not.toHaveBeenCalled();
  });

  test('3b regression: post-quiz state set, ordinary chat text -> handlePostQuizChat still runs', async () => {
    mockGetPostQuizState.mockResolvedValue({ studentName: 'Zara', topic: 'Fractions' });

    await run(CHILD_PHONE, 'what is a fraction?', CHILD_USER);

    expect(mockHandlePostQuizChat).toHaveBeenCalled();
    expect(mockBeginFromCodeLocked).not.toHaveBeenCalled();
  });

  test('4 regression: an active session, body "A" -> handleAnswer still runs, the join is never invoked', async () => {
    mockGetActiveState.mockResolvedValue({ currentQuestionId: 'q1' });

    await run(CHILD_PHONE, 'A', CHILD_USER);

    expect(mockHandleAnswer).toHaveBeenCalledWith(CHILD_PHONE, 'A', { currentQuestionId: 'q1' });
    expect(mockBeginFromCodeLocked).not.toHaveBeenCalled();
  });
});
