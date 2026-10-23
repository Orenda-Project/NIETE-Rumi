'use strict';
/**
 * bd-a73p5m — a coach's "lesson plan" opens the Lesson Plans tab, through every plain door, end to end.
 *
 * The operator, 23 Oct 2026: "A coach who types 'lesson plan' on WhatsApp still gets 'Send a lesson plan', not the new
 * tab -- they can get new tab". Since bd-4joiqz a leader reads every lesson plan at /portal/teacher/lessons (the coach
 * app's Lesson Plans tab, and the classic leader menu's Lesson Plans).
 *
 * Driven through the REAL text handler and the REAL menu router (the harness of app-redirect-routing.test.js), then the
 * minted link through the REAL GET /go router: typed "lesson plan" (bare_command), the "Lesson plan" chip (chip), the
 * menu's Lesson Plans row (menu) and its number (menu_choice). Production's switch value is "coaches". Mocked: the DB
 * (memory), the WhatsApp send layer, the LLM, redis, and the portal's user/app lookups at /go.
 */

jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

const http = require('http');
const express = require('express');
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
// The portal's own sink, for the /go router.
jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush() {}, isEnabled: () => true }));

const { PROMPTS } = require('../../bot/shared/config/conversational-components');

const PHONE = '923002220011';
const PORTAL = 'https://portal.example.test';
const person = (id, role) => ({
  id, phone_number: PHONE, name: 'P', first_name: 'P', role,
  preferred_language: 'en', registration_completed: true, registration_state: 'completed',
});
const COACH = person('u-coach', 'coach');
const PRINCIPAL = person('u-principal', 'principal');
const TEACHER = person('u-teacher', 'teacher');

// Production on 23 Oct: the teacher link for every teacher, the leader link for coaches.
const PROD = [
  { key: 'app_redirect_lesson_plan', value: 'teachers' },
  { key: 'portal_teacher_v2', value: 'teachers' },
  { key: 'leader_app_lesson_plan', value: 'coaches' },
];

const ENV = { ...process.env };
let handler; let me;
function load(user, settings = PROD) {
  jest.resetModules();
  me = { ...user };
  mockDb = makeDb({ users: [{ ...user }], app_settings: settings.map((r) => ({ ...r })), user_feature_first_use: [], coaching_sessions: [] });
  handler = require('../../bot/shared/handlers/text-message.handler');
}

async function say(body) {
  global.__TEST_USER__ = { ...me };
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, PHONE, body, { ...me });
  } catch (_) { /* a branch this suite does not stub — the assertions say what mattered */ }
  await new Promise((r) => setImmediate(r));
}
const menu = () => require('../../bot/shared/services/menu.service');

// The four plain "open lesson plans" doors, as a coach reaches them.
const DOORS = [
  ['typed "lesson plan"', 'bare_command', () => say('lesson plan')],
  ['the "Lesson plan" chip', 'chip', () => say(PROMPTS[0])],
  ['the menu\'s Lesson Plans row', 'menu', () => menu().handleMenuButtonResponse({ ...me }, PHONE, 'menu_lesson_plan', 'en')],
  ['the menu number for Lesson Plans', 'menu_choice', () => menu().handleMenuChoice('2', me.id, 'sess-1', PHONE, 'text', 'en')],
];

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co', PAKISTAN_LP_FLOW_ID: 'flow-lp' };
  delete process.env.APP_STORE_URL;
});
afterAll(() => { process.env = ENV; });

// ── GET /go through the real router: where the link a coach was sent actually lands ──
let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
async function tap(url, { teacherApp = false, coachApp = false } = {}) {
  const token = url.slice(`${PORTAL}/go/`.length);
  const sessions = [];
  const a = express();
  a.use((req, _res, next) => {
    const s = { regenerate(cb) { cb(); }, save(cb) { cb(); } };
    req.session = s; sessions.push(s); next();
  });
  a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
    findUser: async (id) => (id === me.id ? { id: me.id, name: 'P' } : null),
    isTeacherV2: async () => teacherApp,
    isCoachApp: async () => coachApp,
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  const res = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: `/go/${token}` }, (r) => {
      r.resume(); r.on('end', () => resolve({ status: r.statusCode, location: r.headers.location }));
    }).on('error', reject);
  });
  return { ...res, session: sessions[0] };
}

const ctas = () => mockWa.sendCtaUrl.mock.calls;
const lpFlows = () => mockWa.sendFlow.mock.calls.filter(([, o]) => o && o.flowId === 'flow-lp');

describe('a coach under "coaches", through each plain door', () => {
  test.each(DOORS)('%s (%s): one button, and the link lands on the Lesson Plans tab', async (_label, door, open) => {
    load(COACH);
    await open();
    expect(ctas()).toHaveLength(1);
    expect(lpFlows()).toHaveLength(0);
    const [to, { body, buttonText, url }] = ctas()[0];
    expect(to).toBe(PHONE);
    expect(body).toBe('Read the lesson plans your teachers get, and send one to a teacher.');
    expect(buttonText).toBe('Lesson plans');
    // The coach app off (the classic leader portal) and on: the same tab either way.
    for (const coachApp of [false, true]) {
      const res = await tap(url, { coachApp });
      expect(res.status).toBe(303);
      expect(res.location).toBe('/portal/teacher/lessons');
      expect(res.session).toEqual(expect.objectContaining({ portalUserId: COACH.id, isPortalAuth: true }));
    }
    // The funnel row names the door the coach came through, and the audience.
    const logger = require('../../bot/shared/utils/logger');
    const cmd = logger.logToFile.mock.calls.find(([n]) => n === 'app_funnel.command');
    expect(cmd[1]).toEqual(expect.objectContaining({ feature: 'lesson_plan', door, verdict: 'link', audience: 'leader' }));
  });

  test('with FLN share off for everyone (no portal_fln_share row), the coach still gets the tab', async () => {
    load(COACH);
    expect(mockDb.tables.app_settings.some((r) => r.key === 'portal_fln_share')).toBe(false);
    await say('lesson plan');
    expect(ctas()).toHaveLength(1);
    expect((await tap(ctas()[0][1].url)).location).toBe('/portal/teacher/lessons');
  });

  test('an analytics-only coach keeps today\'s WhatsApp lesson-plan Flow', async () => {
    load(COACH, [...PROD, { key: 'portal_analytics_only', value: [COACH.id] }]);
    await say('lesson plan');
    expect(ctas()).toHaveLength(0);
    expect(lpFlows()).toHaveLength(1);
    expect(require('../../bot/shared/utils/logger').logToFile).toHaveBeenCalledWith(
      expect.stringMatching(/Leader app link: not for this user/), expect.objectContaining({ why: 'analytics_only' }));
  });
});

describe('everyone else is exactly as before', () => {
  test.each(DOORS)('a principal under "coaches", %s: the WhatsApp lesson-plan Flow, no link', async (_label, _door, open) => {
    load(PRINCIPAL);
    await open();
    expect(ctas()).toHaveLength(0);
    expect(lpFlows()).toHaveLength(1);
  });

  test('a teacher: the teacher link, which lands on her Lesson Plans on the teacher app (off it, today\'s dashboard)', async () => {
    load(TEACHER);
    await say('lesson plan');
    expect(ctas()).toHaveLength(1);
    const [, { body, buttonText, url }] = ctas()[0];
    expect(body).toBe('Open your lesson plans.');
    expect(buttonText).toBe('Lesson plans');
    expect((await tap(url, { teacherApp: true })).location).toBe('/portal/teacher/lessons');
    expect((await tap(url, { teacherApp: false })).location).toBe('/portal/dashboard');
  });
});
