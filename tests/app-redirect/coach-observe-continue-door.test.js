'use strict';
// The text handler builds its LLM client when it loads on some branches; nothing here calls a model.
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
/**
 * The WhatsApp doors that bring a coach on the portal's HITL switches to observe: /observe, and /observe2 (retired or
 * not, it asks the same 'observe' door). Each answers with the app's button and then ONE "Continue on WhatsApp" reply
 * button, and nothing else: the WhatsApp visit Flow waits for the tap. A principal gets the app's button only; a coach
 * the switches do not name gets today's WhatsApp /observe.
 *
 * Drives the REAL text handler, with the harness principal-app-observe-door.test.js uses.
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

const PHONE = '923002220012';
const PORTAL = 'https://portal.example.test';
const person = (id, role) => ({
  id, phone_number: PHONE, name: 'Test Person', first_name: 'Test', role, school_id: 's-1',
  preferred_language: 'en', registration_completed: true, registration_state: 'completed', preferences: { observe_onboarded: true },
});
const COACH = person('60530046-7ac3-4ea3-a976-b43c37c23213', 'coach');
const PRINCIPAL = person('33333333-3333-4333-8333-333333333333', 'principal');

const ENV = {
  INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co',
  OBSERVE_MEWAKA_FLOW_ID: 'flow-observe', OBSERVE_VISIT_FLOW_ID: 'flow-visit', OBSERVE_SCHEDULING_UI: 'true',
};

/** The portal's HITL switches naming this user — prod's shape on 24 Nov. */
const hitlFor = (id) => [['portal_coach_v2', true], ['portal_coach_full_app', [id]], ['portal_coach_flow_v2', [id]]];

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

const ctas = () => mockWa.sendCtaUrl.mock.calls;
const waButtons = () => mockWa.sendInteractiveButtons.mock.calls
  .filter(([, p]) => (p.buttons || []).some((b) => b.id === 'coach_app_wa:observe'));
const pageOf = (opts) => link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length)).f;

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  Object.assign(process.env, ENV);
});
afterAll(() => { for (const k of Object.keys(ENV)) delete process.env[k]; });

describe('a coach on the portal\'s HITL switches', () => {
  test.each(['/observe', '/Observe', '/observe2'])('%j → the app\'s button, then the "Continue on WhatsApp" button; no Flow', async (text) => {
    load(COACH, hitlFor(COACH.id));
    await say(COACH, text);
    expect(ctas()).toHaveLength(1);
    expect(pageOf(ctas()[0][1])).toBe('coach_observe');
    expect(waButtons()).toHaveLength(1);
    expect(mockWa.sendFlow).not.toHaveBeenCalled();
    expect(mockGetResponse).not.toHaveBeenCalled();
  });

  test('/observe2 while it is retired: the retired line, then the same two buttons', async () => {
    load(COACH, [...hitlFor(COACH.id), ['observe2_retired', 'on']]);
    await say(COACH, '/observe2');
    expect(ctas()).toHaveLength(1);
    expect(pageOf(ctas()[0][1])).toBe('coach_observe');
    expect(waButtons()).toHaveLength(1);
    expect(mockWa.sendFlow).not.toHaveBeenCalled();
  });

  test('in Urdu: the Urdu WhatsApp button', async () => {
    const ur = { ...COACH, preferred_language: 'ur' };
    load(ur, hitlFor(COACH.id));
    await say(ur, '/observe');
    expect(waButtons()).toHaveLength(1);
  });
});

describe('a principal: the app only', () => {
  test.each(['/observe', 'observe'])('%j on the principal app (and the flow switch) → the app\'s button only', async (text) => {
    load(PRINCIPAL, [['portal_principal_app', [PRINCIPAL.id]], ['portal_coach_flow_v2', [PRINCIPAL.id]]]);
    await say(PRINCIPAL, text);
    expect(ctas()).toHaveLength(1);
    expect(pageOf(ctas()[0][1])).toBe('principal_observe');
    expect(waButtons()).toHaveLength(0);
  });
});

describe('a coach the switches do not name: today\'s WhatsApp /observe', () => {
  test.each([
    ['no switches', []],
    ['the full app but not the flow switch', [['portal_coach_v2', true], ['portal_coach_full_app', ['someone-else']]]],
    ['the flow switch without them', [['portal_coach_v2', true], ['portal_coach_full_app', [COACH.id]], ['portal_coach_flow_v2', ['someone-else']]]],
  ])('%s: no link, no WhatsApp button, the visit Flow goes', async (_name, settings) => {
    load(COACH, settings);
    await say(COACH, '/observe');
    expect(ctas()).toHaveLength(0);
    expect(waButtons()).toHaveLength(0);
    expect(mockWa.sendFlow).toHaveBeenCalledWith(PHONE, expect.objectContaining({ flowId: 'flow-visit' }));
  });
});
