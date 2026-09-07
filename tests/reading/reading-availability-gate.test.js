/**
 * Reading assessment is advertised on a deployment that cannot run it.
 *
 * NIETE has the reading CODE and the reading TABLES — they were ported — but no
 * reading Flow was ever published to its WhatsApp account, so
 * READING_ASSESSMENT_FLOW_ID is unset and `WhatsAppService.sendFlow({ flowId:
 * undefined })` cannot succeed. Production, twenty days: 43 teachers, 57
 * attempts at `/reading test`, 57 failures, and not one `reading_assessments`
 * row ever written. Every one of those teachers was told "something went wrong…
 * please try again later" — a transient-fault story about a permanent absence,
 * which is precisely why they kept trying.
 *
 * Compounding it, feature-linker.service was *inviting* them: reading at p=0.50
 * after every coaching session and p=0.25 after every lesson plan, with no
 * availability check anywhere in the file.
 *
 * WHY THIS SUITE RUNS THE REAL HANDLER. The question is "what does a teacher who
 * types /reading test actually receive", and that is a property of what executes,
 * not of what the source says. A grep-green branch can still be a runtime
 * ReferenceError. So the mocks stop at the network/service boundary (supabase,
 * redis, the LLM client, WhatsAppService, the intro-video service) and the
 * dispatch decision, the availability gate and the string catalog are all the
 * real ones. Mock set copied from tests/quiz/transcript-quiz-flow-dispatch.js,
 * which is the other suite that boots this handler.
 */

jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

const { installFrom } = require('../quiz/helpers/supabase-chain');

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
const mockSendButtons = jest.fn().mockResolvedValue(undefined);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendFlow: (...a) => mockSendFlow(...a),
  sendInteractiveMessage: (...a) => mockSendInteractive(...a),
  sendInteractiveButtons: (...a) => mockSendButtons(...a),
  sendVideoFromUrl: jest.fn().mockResolvedValue(undefined),
  sendTypingIndicator: jest.fn(),
  markAsRead: jest.fn(),
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
}));

jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  sendFirstUseIntroIfNeeded: jest.fn().mockResolvedValue(false),
  markFeatureUsed: jest.fn().mockResolvedValue(undefined),
  hasSeenIntroVideo: jest.fn().mockResolvedValue(true),
  markVideoShown: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn(),
  },
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

const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));

const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');

const PHONE = '923002220000';
const USER = {
  id: 'u-teacher', phone_number: PHONE, first_name: 'Ayesha',
  preferred_language: 'en', registration_completed: true, registration_state: 'completed',
};

function seed(language = 'en', { recentCoaching = false } = {}) {
  installFrom(mockFrom, {
    users: { data: [{ ...USER, preferred_language: language }], error: null },
    coaching_sessions: {
      data: recentCoaching ? [{ created_at: new Date().toISOString() }] : [],
      error: null,
    },
    lesson_plans: { data: [], error: null },
    reading_assessments: { data: [], error: null },
    user_feature_first_use: { data: [], error: null },
    feature_suggestions: { data: null, error: null },
    students: { data: [], error: null },
  });
}

let handler;
async function run(body, user = USER) {
  global.__TEST_USER__ = user;
  jest.resetModules();
  handler = require('../../bot/shared/handlers/text-message.handler');
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, PHONE, body, user);
  } catch (_) { /* branches past /reading test reach services this suite does not stub */ }
  await new Promise((r) => setImmediate(r));
}

/** Every logToFile call whose 3rd positional arg is 'warn' or 'error'. */
const loudLogs = () => mockLog.mock.calls.filter((c) => c[2] === 'warn' || c[2] === 'error');
/** Everything WhatsAppService.sendMessage was asked to send, joined. */
const sentText = () => mockSendMessage.mock.calls.map((c) => c[1]).join('\n');

beforeEach(() => {
  jest.clearAllMocks();
  mockSendFlow.mockResolvedValue(true);
  delete process.env.READING_ASSESSMENT_FLOW_ID;
  seed('en');
});

afterAll(() => {
  delete process.env.READING_ASSESSMENT_FLOW_ID;
});

describe('/reading test — with no reading Flow provisioned', () => {
  test('does NOT attempt the send', async () => {
    await run('/reading test');
    // The bug: sendFlow was called with flowId: undefined, 57 times out of 57.
    expect(mockSendFlow).not.toHaveBeenCalled();
  });

  test('replies with the honest "not available here" line, not "try again later"', async () => {
    await run('/reading test');

    const text = sentText();
    expect(text).toBe(UX_STRINGS.readingNotAvailable.en);
    // The copy that shipped for twenty days, and the reason teachers retried.
    expect(text).not.toMatch(/try again/i);
    expect(text).not.toMatch(/something went wrong/i);
  });

  test('replies in Urdu to an Urdu teacher, read from preferred_language', async () => {
    seed('ur');
    await run('/reading test', { ...USER, preferred_language: 'ur' });

    expect(sentText()).toBe(UX_STRINGS.readingNotAvailable.ur);
    expect(sentText()).toMatch(/[؀-ۿ]/);
  });

  test('logs the refusal at warn or error — never info', async () => {
    await run('/reading test');

    const loud = loudLogs().filter((c) => /reading/i.test(String(c[0])));
    expect(loud.length).toBeGreaterThanOrEqual(1);
    expect(['warn', 'error']).toContain(loud[0][2]);
    // The variable has to be nameable from the log line alone.
    expect(JSON.stringify(loud[0])).toMatch(/READING_ASSESSMENT_FLOW_ID/);
  });
});

describe('/reading test — with the Flow provisioned', () => {
  beforeEach(() => { process.env.READING_ASSESSMENT_FLOW_ID = '1234567890'; });

  test('still opens the Flow — the gate is presence, not a kill switch', async () => {
    await run('/reading test');

    expect(mockSendFlow).toHaveBeenCalledTimes(1);
    const [to, flowData] = mockSendFlow.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(flowData.flowId).toBe('1234567890');
    expect(sentText()).not.toContain(UX_STRINGS.readingNotAvailable.en);
  });

  test('a send that IS attempted and fails stays a DISTINCT outcome', async () => {
    // "Not configured" and "the send failed" must never collapse into one
    // message: the teacher and the on-caller each need the true state.
    mockSendFlow.mockResolvedValue(false);

    await run('/reading test');

    expect(mockSendFlow).toHaveBeenCalledTimes(1);
    expect(sentText()).not.toBe(UX_STRINGS.readingNotAvailable.en);
    expect(sentText()).toMatch(/something went wrong/i);

    const loud = loudLogs().filter((c) => /reading assessment flow/i.test(String(c[0])));
    expect(loud.length).toBeGreaterThanOrEqual(1);
    expect(loud[0][2]).toBe('error');
  });
});

describe('feature-linker — we do not advertise what we cannot run', () => {
  let randomSpy;
  beforeEach(() => {
    jest.resetModules();
    // Every probability roll succeeds, so a feature that is NOT offered was
    // suppressed by the gate rather than by luck.
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => randomSpy.mockRestore());

  const linker = () => require('../../bot/shared/services/feature-linker.service');

  test('after a coaching session, reading is NOT offered when the Flow is absent', async () => {
    delete process.env.READING_ASSESSMENT_FLOW_ID;

    await linker().suggestNext('coaching', USER.id, PHONE, 'en');

    const text = sentText() + JSON.stringify(mockSendButtons.mock.calls);
    expect(text).not.toMatch(/reading test/i);
    expect(text).not.toMatch(/reading fluency/i);
  });

  test('after a lesson plan, reading is NOT offered when the Flow is absent', async () => {
    delete process.env.READING_ASSESSMENT_FLOW_ID;
    // The lesson_plan row offers coaching FIRST (p=0.40) and returns after one
    // suggestion, so with every roll succeeding this assertion would pass
    // without the gate ever being consulted. A coaching session inside the
    // 7-day window takes that link off the table and puts reading — the p=0.25
    // second entry — in front of the gate, which is the thing under test.
    seed('en', { recentCoaching: true });

    await linker().suggestNext('lesson_plan', USER.id, PHONE, 'en');

    const text = sentText() + JSON.stringify(mockSendButtons.mock.calls);
    expect(text).not.toMatch(/reading test/i);
  });

  test('with the Flow present, the reading offer comes back', async () => {
    process.env.READING_ASSESSMENT_FLOW_ID = '1234567890';

    await linker().suggestNext('coaching', USER.id, PHONE, 'en');

    const text = sentText() + JSON.stringify(mockSendButtons.mock.calls);
    expect(text).toMatch(/reading test/i);
  });

  test('the suppression is keyed on the feature name, not hardcoded to reading', () => {
    // The bug class is "a gated feature is off and we invited her anyway".
    // Reading is the instance we found; the gate has to be general.
    const { isFeatureRunnable, FEATURE_GATES } = require('../../bot/shared/config/feature-availability');
    const env = {};
    expect(isFeatureRunnable('reading', env)).toBe(false);
    expect(isFeatureRunnable('reading', { READING_ASSESSMENT_FLOW_ID: 'x' })).toBe(true);
    // A feature nobody has gated is runnable — this is a stop-advertising gate,
    // not a second registry every new feature must remember to join.
    expect(isFeatureRunnable('coaching', env)).toBe(true);
    expect(Object.keys(FEATURE_GATES)).toContain('reading');
  });

  test('a placeholder value does not count as provisioned', () => {
    const { isFeatureRunnable } = require('../../bot/shared/config/feature-availability');
    expect(isFeatureRunnable('reading', { READING_ASSESSMENT_FLOW_ID: '   ' })).toBe(false);
    expect(isFeatureRunnable('reading', { READING_ASSESSMENT_FLOW_ID: 'YOUR_FLOW_ID' })).toBe(false);
  });
});
