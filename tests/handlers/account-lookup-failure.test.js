/**
 * A DATABASE OUTAGE IS NOT "YOU ARE NOT REGISTERED".
 *
 * Reported by a coach: `/video` told a registered teacher she had no account.
 * She was registered and actively using the bot. Supabase was unreachable
 * (Cloudflare 522) at the moment she typed, `getOrCreateUser` threw, the call
 * site swallowed the throw into `user = null`, and the `!user` branch sent the
 * registration guidance — a message that is both wrong and blaming.
 *
 * Two DIFFERENT states share that one branch:
 *
 *   lookup failed   — we could not reach the database. Nothing is known about
 *                     her account, so nothing may be asserted about it. She is
 *                     told, honestly, that the fault is ours, and the failure
 *                     is logged at `error` so it can be alerted on.
 *   no account      — the lookup succeeded and returned nothing. Only then is
 *                     the registration guidance true.
 *
 * The whole handler runs here — mocks stop at the network boundary (supabase,
 * redis, the LLM client, WhatsApp, the quiz services) — because the question is
 * "which message does a teacher who types /video actually receive?", and that is
 * a property of what runs, not of what a grep can see. Mock set copied from
 * tests/quiz/transcript-quiz-flow-dispatch.test.js, the other suite that loads
 * this handler.
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
  parseShareCode: jest.fn(() => null),
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
// The child escape hatch inside the `!user` branch of /video. It must miss here
// so the branch under test is the one that actually sends copy.
jest.mock('../../bot/shared/services/quiz/student-identity.service', () => ({
  findByPhone: jest.fn().mockResolvedValue([]),
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

const mockGetOrCreateUser = jest.fn();
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: (...a) => mockGetOrCreateUser(...a),
  getOrCreateSession: jest.fn().mockResolvedValue('sess-1'),
  updateSessionType: jest.fn(),
  storeConversation: jest.fn(),
  storeLessonPlan: jest.fn(),
  getConversationHistory: jest.fn().mockResolvedValue([]),
}));

const mockLogToFile = jest.fn();
const mockLogError = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: (...a) => mockLogToFile(...a),
  logError: (...a) => mockLogError(...a),
}));

const PHONE = '923002220000';

// The exact 522 shape: the PostgREST client rejects, it does not resolve null.
const outage = () => Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });

function seed() {
  installFrom(mockFrom, {
    users: { data: [], error: null },
    quiz_sessions: { data: null, error: null },
    coaching_sessions: { data: [], error: null },
    lesson_plans: { count: 0, error: null },
  });
}

async function run(body) {
  jest.resetModules();
  const handler = require('../../bot/shared/handlers/text-message.handler');
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, PHONE, body, null);
  } catch (_) { /* branches past the one under test reach services this suite does not stub */ }
  await new Promise((r) => setImmediate(r));
}

const sent = () => mockSendMessage.mock.calls.map((c) => c[1]).join('\n---\n');

beforeEach(() => {
  jest.clearAllMocks();
  seed();
});

// ── the discriminant, at the source ───────────────────────────────────────
describe('the two states are distinguishable at the source', () => {
  test('the copy catalog carries a lookup-failure string in BOTH offered languages', () => {
    const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');
    expect(UX_STRINGS.accountLookupUnavailable).toBeDefined();
    for (const lang of ['en', 'ur']) {
      const s = resolveUx('accountLookupUnavailable', { language: lang });
      expect(typeof s).toBe('string');
      expect(s.trim().length).toBeGreaterThan(0);
      // WhatsApp body cap, measured in CODE POINTS (Urdu diverges from .length).
      expect([...s].length).toBeLessThanOrEqual(1024);
      // It must never assert anything about her account existing or not.
      expect(s).not.toMatch(/register|registration/i);
    }
    // The Urdu must not carry a gendered second-person verb stem.
    const ur = resolveUx('accountLookupUnavailable', { language: 'ur' });
    expect(ur).not.toMatch(/رہی ہوں گی|رہے ہوں گے|کر رہی ہیں|کر رہے ہیں/);
  });
});

// ── the reported path ─────────────────────────────────────────────────────
describe('/video when the database is unreachable', () => {
  test('she is NOT told she is unregistered', async () => {
    mockGetOrCreateUser.mockRejectedValue(outage());

    await run('/video');

    expect(mockSendMessage).toHaveBeenCalled();
    expect(sent()).not.toMatch(/could not find your account/i);
    expect(sent()).not.toMatch(/send me a message first/i);
    expect(sent()).not.toMatch(/اکاؤنٹ نہیں مل سکا/);
  });

  test('she gets the honest "our side" copy, in both languages', async () => {
    const { resolveUx } = require('../../bot/shared/config/ux-strings');
    mockGetOrCreateUser.mockRejectedValue(outage());

    await run('/video');

    expect(sent()).toContain(resolveUx('accountLookupUnavailable', { language: 'en' }));
    expect(sent()).toContain(resolveUx('accountLookupUnavailable', { language: 'ur' }));
  });

  test('the failure is logged at error with the phone number', async () => {
    mockGetOrCreateUser.mockRejectedValue(outage());

    await run('/video');

    const errorCalls = mockLogError.mock.calls
      .concat(mockLogToFile.mock.calls.filter((c) => c[2] === 'error'));
    expect(errorCalls.length).toBeGreaterThan(0);
    const blob = JSON.stringify(errorCalls);
    expect(blob).toMatch(/lookup/i);
    expect(blob).toContain(PHONE);
  });
});

// ── the other state, still true ───────────────────────────────────────────
describe('/video when the lookup SUCCEEDS and there is genuinely no account', () => {
  test('she still gets the registration guidance', async () => {
    mockGetOrCreateUser.mockResolvedValue(null);

    await run('/video');

    expect(sent()).toMatch(/could not find your account/i);
  });
});
