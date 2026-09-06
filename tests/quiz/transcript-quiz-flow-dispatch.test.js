/**
 * R6 lane M — `/quiz` opens the Flow when TRANSCRIPT_QUIZ_FLOW_ID is set, and
 * sends today's list message when it is not.
 *
 * The presence gate IS the rollback lever, so it is proven by running the real
 * 2,900-line text handler, not by grepping it: a grep-green branch can still be
 * a runtime ReferenceError, and the question here — "which message does a
 * teacher who types /quiz actually receive?" — is a property of what runs.
 * Mocks stop at the network boundary (supabase, redis, the LLM client,
 * WhatsApp); the dispatch decision and the list service are the real ones.
 *
 * Mock set copied from tests/quiz/student-mode-gate.test.js, which is the other
 * suite that loads this handler.
 */

jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

const { installFrom } = require('./helpers/supabase-chain');

const mockFrom = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockFrom(...a),
  rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  auth: {},
}));

jest.mock('../../bot/shared/services/openai.service', () => ({
  getResponseWithFormat: jest.fn().mockResolvedValue('ok'),
  detectIntent: jest.fn().mockResolvedValue({ type: 'general' }),
  generateResponse: jest.fn().mockResolvedValue('ok'),
}));

const mockSendMessage = jest.fn().mockResolvedValue(undefined);
const mockSendFlow = jest.fn().mockResolvedValue(true);
const mockSendInteractive = jest.fn().mockResolvedValue(undefined);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendFlow: (...a) => mockSendFlow(...a),
  sendInteractiveMessage: (...a) => mockSendInteractive(...a),
  sendInteractiveButtons: jest.fn().mockResolvedValue(undefined),
  sendTypingIndicator: jest.fn(),
  markAsRead: jest.fn(),
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
}));

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() },
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  setNX: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  parseShareCode: jest.requireActual('../../bot/shared/services/quiz/video-quiz-share.service').parseShareCode,
  beginFromCodeLocked: jest.fn().mockResolvedValue(true),
  consumeJoinReply: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/services/quiz/quiz-session.service', () => ({
  getPostQuizState: jest.fn().mockResolvedValue(null),
  endPostQuizChat: jest.fn(),
  handlePostQuizChat: jest.fn(),
  getActiveState: jest.fn().mockResolvedValue(null),
  handleAnswer: jest.fn(),
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
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const PHONE = '923002220000';
const USER = {
  id: 'u-teacher', phone_number: PHONE, first_name: 'Ayesha',
  preferred_language: 'en', registration_completed: true, registration_state: 'completed',
};

const LESSON = {
  id: 'cs-1', user_id: USER.id, status: 'completed', observation_type: null,
  created_at: new Date().toISOString(),
  transcript_text: 'x'.repeat(4000),
  analysis_data: { topic: 'Electric circuits', subject: 'science' },
};

function seed(sessions) {
  installFrom(mockFrom, {
    coaching_sessions: { data: sessions, error: null },
    quizzes: { data: [], error: null },
    quiz_sessions: { data: [], error: null },
    users: { data: [USER], error: null },
    students: { data: [], error: null },
    lesson_plans: { count: 0, error: null },
  });
}

let handler;
async function run(body) {
  global.__TEST_USER__ = USER;
  jest.resetModules();
  handler = require('../../bot/shared/handlers/text-message.handler');
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, PHONE, body, USER);
  } catch (_) { /* branches below /quiz reach services this suite does not stub */ }
  await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  delete process.env.TRANSCRIPT_QUIZ_FLOW_ID;
  seed([LESSON]);
});

afterAll(() => {
  delete process.env.TRANSCRIPT_QUIZ_ENABLED;
  delete process.env.TRANSCRIPT_QUIZ_FLOW_ID;
});

describe('/quiz dispatch — the presence gate is the rollback lever', () => {
  test('with TRANSCRIPT_QUIZ_FLOW_ID set, /quiz sends the Flow and no list message', async () => {
    process.env.TRANSCRIPT_QUIZ_FLOW_ID = '1234567890';

    await run('/quiz');

    expect(mockSendFlow).toHaveBeenCalledTimes(1);
    const [to, flowData] = mockSendFlow.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(flowData.flowId).toBe('1234567890');
    // data_exchange mode: a token and NO screen (whatsapp.service picks the mode
    // from exactly that pair).
    expect(flowData.screen).toBeUndefined();
    expect(flowData.flowToken).toMatch(/^u-teacher:transcript-quiz:\d+$/);
    expect(flowData.header).toBeTruthy();
    expect(flowData.body).toBeTruthy();
    expect(flowData.buttonText).toBeTruthy();
    expect(mockSendInteractive).not.toHaveBeenCalled();
  });

  test('with the var unset, /quiz sends today’s interactive list and no Flow', async () => {
    await run('/quiz');

    expect(mockSendFlow).not.toHaveBeenCalled();
    expect(mockSendInteractive).toHaveBeenCalledTimes(1);
    const [, payload] = mockSendInteractive.mock.calls[0];
    expect(payload.action.sections[0].rows.length).toBeGreaterThan(0);
  });

  test('a teacher with no lessons yet gets the plain explanation, never an empty Flow', async () => {
    process.env.TRANSCRIPT_QUIZ_FLOW_ID = '1234567890';
    seed([]);

    await run('/quiz');

    expect(mockSendFlow).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalled();
    const bodies = mockSendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(bodies).toMatch(/No lessons yet|ابھی کوئی سبق نہیں/);
  });

  test('the Flow chat bubble fits WhatsApp’s caps in both languages', () => {
    const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
    const cp = (s) => [...String(s)].length;
    for (const lang of ['en', 'ur']) {
      expect(cp(UX_STRINGS.tqFlowChatHeader[lang])).toBeLessThanOrEqual(60);
      expect(cp(UX_STRINGS.tqFlowChatBody[lang])).toBeLessThanOrEqual(1024);
      expect(cp(UX_STRINGS.tqFlowChatCta[lang])).toBeLessThanOrEqual(20);
    }
  });
});
