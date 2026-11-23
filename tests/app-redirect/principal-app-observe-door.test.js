'use strict';
// The text handler builds its LLM client when it loads on some branches; nothing here calls a model.
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
/**
 * bd-eqkr0n (queue #203 follow-up) — the WhatsApp doors that bring a principal to the app's Observe page.
 *
 * The operator, 20 Nov ~14:55: "if principal does a /observe, or just observe, we send the IAB button like we do for
 * others." So for a principal the principal app is on for, both `/observe` and a bare "observe" answer with ONE
 * cta_url message (the app's button) and nothing else: no WhatsApp /observe Flow, no AI answer. A bare "observe" is a
 * door for her only: a principal the switch does not name, and a teacher, get exactly what they got before (the open
 * message goes to the classifier, as it always did).
 *
 * Drives the REAL text handler, with the harness app-redirect-routing.test.js uses.
 */

jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

const { makeDb } = require('../quiz/helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));

const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn(async (k) => (mockStore.has(k) ? JSON.stringify(mockStore.get(k)) : null)),
    set: jest.fn(async (k, v) => { mockStore.set(k, typeof v === 'string' ? JSON.parse(v) : v); return 'OK'; }),
    del: jest.fn(async (k) => { mockStore.delete(k); return 1; }),
  },
  get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockStore.set(k, v); return true; }),
  setexWithCeiling: jest.fn(async (k, _t, v) => { mockStore.set(k, typeof v === 'string' ? JSON.parse(v) : v); return true; }),
  setNX: jest.fn(async (k, v) => { if (mockStore.has(k)) return false; mockStore.set(k, v); return true; }),
  delete: jest.fn(async (k) => { mockStore.delete(k); return true; }),
  del: jest.fn(async (k) => { mockStore.delete(k); return true; }),
}));

const mockDetectIntent = jest.fn().mockResolvedValue({ type: 'general' });
const mockGetResponse = jest.fn().mockResolvedValue('a warm answer');
jest.mock('../../bot/shared/services/openai.service', () => ({
  getResponseWithFormat: (...a) => mockGetResponse(...a),
  detectIntent: (...a) => mockDetectIntent(...a),
  generateResponse: jest.fn().mockResolvedValue('ok'),
}));

const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(true),
  sendCtaUrl: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFeatureMenuCarousel: jest.fn().mockResolvedValue(true),
  sendLanguageSelectionList: jest.fn().mockResolvedValue(true),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockWa.sendMessage(...a),
  sendCtaUrl: (...a) => mockWa.sendCtaUrl(...a),
  sendFlow: (...a) => mockWa.sendFlow(...a),
  sendInteractiveMessage: (...a) => mockWa.sendInteractiveMessage(...a),
  sendInteractiveButtons: (...a) => mockWa.sendInteractiveButtons(...a),
  sendFeatureMenuCarousel: (...a) => mockWa.sendFeatureMenuCarousel(...a),
  sendLanguageSelectionList: (...a) => mockWa.sendLanguageSelectionList(...a),
  sendTypingIndicator: jest.fn(),
  markAsRead: jest.fn(),
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
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
jest.mock('../../bot/shared/handlers/exam-checker.handler', () => ({
  ...jest.requireActual('../../bot/shared/handlers/exam-checker.handler'),
  hasActiveExamSession: jest.fn().mockResolvedValue(false),
  handleExamText: jest.fn().mockResolvedValue(null),
}));

const PHONE = '923002220011';
const PORTAL = 'https://portal.example.test';
const person = (id, role) => ({
  id, phone_number: PHONE, name: 'Test Person', first_name: 'Test', role, school_id: 's-1',
  preferred_language: 'en', registration_completed: true, registration_state: 'completed', preferences: { observe_onboarded: true },
});
const PRINCIPAL = person('60530046-7ac3-4ea3-a976-b43c37c23213', 'principal');
const TEACHER = person('22222222-2222-4222-8222-222222222222', 'teacher');

const ENV = {
  INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co',
  OBSERVE_MEWAKA_FLOW_ID: 'flow-observe', OBSERVE_SCHEDULING_UI: 'true',
};

let handler; let link;
function load(user, settings = []) {
  jest.resetModules();
  mockDb = makeDb({
    users: [{ ...user }],
    app_settings: settings.map(([key, value]) => ({ key, value })),
    user_feature_first_use: [],
    coaching_sessions: [],
    leader_schools: [],
  });
  handler = require('../../bot/shared/handlers/text-message.handler');
  link = require('../../bot/shared/services/app-login-link');
}

async function say(user, body) {
  global.__TEST_USER__ = { ...user };
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, PHONE, body, { ...user });
  } catch (_) { /* a branch this suite does not stub — the assertions say what mattered */ }
  await new Promise((r) => setImmediate(r));
}

const buttons = () => mockWa.sendCtaUrl.mock.calls;
const pageOf = (opts) => link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length)).f;

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  Object.assign(process.env, ENV);
});
afterAll(() => { for (const k of Object.keys(ENV)) delete process.env[k]; });

describe('a principal on the principal app', () => {
  test.each(['/observe', 'observe', 'Observe', ' observe. ', 'OBSERVE!', '/Observe'])(
    '%j → ONE button to her Observations page, and nothing else',
    async (text) => {
      load(PRINCIPAL, [['portal_principal_app', [PRINCIPAL.id]]]);
      await say(PRINCIPAL, text);
      expect(buttons()).toHaveLength(1);
      const opts = buttons()[0][1];
      expect(opts.body).toBe('Take your observation in the app.');
      expect(pageOf(opts)).toBe('principal_observe');
      expect(mockWa.sendFlow).not.toHaveBeenCalled();
      expect(mockWa.sendInteractiveMessage).not.toHaveBeenCalled();
      expect(mockGetResponse).not.toHaveBeenCalled();
    },
  );

  test('a sentence that mentions observing is not the door ("how do I observe a class?")', async () => {
    load(PRINCIPAL, [['portal_principal_app', [PRINCIPAL.id]]]);
    await say(PRINCIPAL, 'how do I observe a class?');
    expect(buttons()).toHaveLength(0);
  });
});

describe('everyone else: as before', () => {
  test('a principal the switch does not name: a bare "observe" gets no button (the classifier answers, as before)', async () => {
    load(PRINCIPAL, []);
    await say(PRINCIPAL, 'observe');
    expect(buttons()).toHaveLength(0);
  });

  test('a principal the switch does not name: /observe gets no button (the WhatsApp /observe runs)', async () => {
    load(PRINCIPAL, []);
    await say(PRINCIPAL, '/observe');
    expect(buttons()).toHaveLength(0);
  });

  test('a teacher\'s bare "observe" (even on the principal app\'s list) gets no button', async () => {
    load(TEACHER, [['portal_principal_app', [TEACHER.id]]]);
    await say(TEACHER, 'observe');
    expect(buttons()).toHaveLength(0);
  });
});
