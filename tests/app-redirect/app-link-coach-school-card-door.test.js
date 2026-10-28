'use strict';
/**
 * The School card door in the REAL text handler: `/school card [EMIS or name]` and `school card [...]`.
 *
 * Drives handleTextMessage with the harness tests/app-redirect/app-redirect-routing.test.js uses (only the network
 * edges and the LLM are stubbed). A coach on the School card switch and the coach app gets ONE cta_url message and
 * nothing else: no classifier, no AI chat. Everyone else (the switch off, a teacher, a coach off the coach app) gets
 * exactly what the same message got before the door existed: the classifier, then the general AI answer, one message
 * ("a warm answer" here), and no button.
 */

jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

const fs = require('fs');
const path = require('path');
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
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFeatureMenuCarousel: jest.fn().mockResolvedValue(true),
  sendLanguageSelectionList: jest.fn().mockResolvedValue(true),
  sendCtaUrl: jest.fn().mockResolvedValue(true),
  sendListMessage: jest.fn().mockResolvedValue(true),
};
const mockTypingStop = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockWa.sendMessage(...a),
  sendFlow: (...a) => mockWa.sendFlow(...a),
  sendInteractiveMessage: (...a) => mockWa.sendInteractiveMessage(...a),
  sendInteractiveButtons: (...a) => mockWa.sendInteractiveButtons(...a),
  sendFeatureMenuCarousel: (...a) => mockWa.sendFeatureMenuCarousel(...a),
  sendLanguageSelectionList: (...a) => mockWa.sendLanguageSelectionList(...a),
  sendCtaUrl: (...a) => mockWa.sendCtaUrl(...a),
  sendListMessage: (...a) => mockWa.sendListMessage(...a),
  sendTypingIndicator: jest.fn(),
  markAsRead: jest.fn(),
  startContinuousTypingIndicator: () => ({ stop: mockTypingStop }),
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

// The exam session lives in a table the memory stub cannot query (.not()); its
// lookup is stubbed, the keyword matcher stays real.
const mockActiveExam = jest.fn().mockResolvedValue(false);
const mockHandleExamText = jest.fn().mockResolvedValue(null);
jest.mock('../../bot/shared/handlers/exam-checker.handler', () => ({
  ...jest.requireActual('../../bot/shared/handlers/exam-checker.handler'),
  hasActiveExamSession: (...a) => mockActiveExam(...a),
  handleExamText: (...a) => mockHandleExamText(...a),
}));


const PHONE = '923000000011';
const PORTAL = 'https://portal.example.test';
const ME = '60530046-7ac3-4ea3-a976-b43c37c23213';
const base = { phone_number: PHONE, name: 'N', first_name: 'N', preferred_language: 'en', registration_completed: true, registration_state: 'completed' };
const COACH = { ...base, id: ME, role: 'coach' };
const TEACHER = { ...base, id: ME, role: 'teacher' };
const LEADER_SCHOOLS = [
  { leader_user_id: ME, source: 'niete_ict', school_ext_id: 'niete:947', school_name: 'IMSG (I-X) Dhok Sabz', emis: '947' },
  { leader_user_id: ME, source: 'niete_ict', school_ext_id: 'niete:AB12', school_name: 'IMSB (I-V) Dhok Kala Khan', emis: 'AB12' },
];
const SCHOOLS = [
  { id: 's-947', name: 'IMSG (I-X) Dhok Sabz', region: 'Urban-I', emis: '947', is_probable_test: false },
  { id: 's-ab12', name: 'IMSB (I-V) Dhok Kala Khan', region: 'Urban-II', emis: 'AB12', is_probable_test: false },
];
const ON = { portal_coach_school_card: true, portal_coach_v2: [ME] };

const ENV = { ...process.env };
let handler;
async function say(user, body, settings = {}) {
  jest.resetModules();
  mockDb = makeDb({
    users: [{ ...user }],
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    leader_schools: LEADER_SCHOOLS.map((r) => ({ ...r })),
    schools: SCHOOLS.map((r) => ({ ...r })),
    user_feature_first_use: [],
    coaching_sessions: [],
  });
  handler = require('../../bot/shared/handlers/text-message.handler');
  global.__TEST_USER__ = { ...user };
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, PHONE, body, { ...user });
  } catch (_) { /* a branch this suite does not stub; the assertions say what mattered */ }
  await new Promise((r) => setImmediate(r));
}
const ctas = () => mockWa.sendCtaUrl.mock.calls;
const allSends = () => Object.values(mockWa).reduce((n, f) => n + f.mock.calls.length, 0);
const featureOf = (call) => require('../../bot/shared/services/app-login-link').verifyAppLink(call[1].url.split('/go/')[1]).f;

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co' };
});
afterAll(() => { process.env = ENV; });

describe('a coach on the switch and the coach app', () => {
  test.each([
    ['/school card 947', 'coach_school:947'],
    ['/School Card 947', 'coach_school:947'],
    ['school card dhok sabz', 'coach_school:947'],
    ['SCHOOL CARD IMSG (I-X) Dhok Sabz', 'coach_school:947'],
    ['/schoolcard 947', 'coach_school:947'],
    ['/school card AB12', 'coach_school:AB12'],
    ['/school card', 'coach_schools'],
    ['school card', 'coach_schools'],
    ['/school card dhok', 'coach_schools'],
    ['/school card tarnol', 'coach_schools'],
  ])('"%s" → ONE cta_url message (%s), and nothing else: no classifier, no AI chat', async (text, f) => {
    await say(COACH, text, ON);
    expect(ctas()).toHaveLength(1);
    expect(featureOf(ctas()[0])).toBe(f);
    expect(allSends()).toBe(1);
    expect(mockDetectIntent).not.toHaveBeenCalled();
    expect(mockGetResponse).not.toHaveBeenCalled();
    expect(mockTypingStop).toHaveBeenCalled();
  });

  test('the Urdu coach gets the Urdu line', async () => {
    await say({ ...COACH, preferred_language: 'ur' }, '/school card 947', ON);
    expect(ctas()[0][1].buttonText).toBe('کھولیں');
  });
});

describe('everyone else: today\'s handling, unchanged', () => {
  const today = () => {
    expect(ctas()).toHaveLength(0);
    expect(mockDetectIntent).toHaveBeenCalledTimes(1);
    expect(mockGetResponse).toHaveBeenCalledTimes(1);
    expect(mockWa.sendMessage.mock.calls.map(([, b]) => b)).toEqual(['a warm answer']);
    expect(allSends()).toBe(1);
  };
  test.each([
    ['a coach, no switch row', COACH, { portal_coach_v2: [ME] }],
    ['a coach, switch false', COACH, { portal_coach_school_card: false, portal_coach_v2: [ME] }],
    ['a coach, a switch list without them', COACH, { portal_coach_school_card: ['11111111-1111-4111-8111-111111111111'], portal_coach_v2: [ME] }],
    ['a coach on the switch but off the coach app', COACH, { portal_coach_school_card: true }],
    ['a teacher on a "true" switch', TEACHER, { portal_coach_school_card: true, portal_coach_v2: true }],
    ['a principal on a "true" switch', { ...COACH, role: 'principal' }, { portal_coach_school_card: true, portal_coach_v2: true }],
  ])('%s: "/school card 947" goes on as before', async (_l, user, settings) => {
    await say(user, '/school card 947', settings);
    today();
  });

  test.each(['school card', 'school card dhok sabz'])('a teacher: "%s" goes on as before', async (text) => {
    await say(TEACHER, text, { portal_coach_school_card: true, portal_coach_v2: true });
    today();
  });

  test.each(['my school card please', 'school cardiff', 'what is a school card?'])(
    'a coach ON the switch: "%s" is not the command, so it goes on as before', async (text) => {
      await say(COACH, text, ON);
      today();
    });
});
