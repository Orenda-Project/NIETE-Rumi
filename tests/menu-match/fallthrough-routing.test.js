'use strict';
/**
 * bd-xw56ed — a message no door caught is answered from the teacher's live menu.
 *
 * Production, 20 Oct 2026: a teacher typed "/assesments", then "/assesment". Both were answered by the AI chat —
 * first "not a command I can act on", then an offer to write an assessment itself — while the Test Paper button
 * that every registered teacher gets for /assessment was never sent. The operator's rule (20 Oct):
 *   - confident it is one of her menu entries → the in-app (IAB) button for that feature;
 *   - asking for a feature but not sure which → say so, and open the IAB menu;
 *   - a question or conversation → the AI chat, as before; a lone "/word" never reaches chat;
 *   - presentations are no longer routed (not a menu entry).
 *
 * Drives the REAL text handler, the REAL classifier (openai.service + llm-client: only fetch is stubbed), the REAL
 * menu router and the REAL app-redirect/app-login-link. The database client, Redis and the WhatsApp send layer are
 * the stubbed boundaries.
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
const mockUpdateSessionType = jest.fn();
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(async () => global.__TEST_USER__),
  getOrCreateSession: jest.fn().mockResolvedValue('sess-1'),
  updateSessionType: (...a) => mockUpdateSessionType(...a),
  storeConversation: jest.fn(),
  storeLessonPlan: jest.fn(),
  getConversationHistory: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const { resolveUx } = require('../../bot/shared/config/ux-strings');

const REAL_FETCH = globalThis.fetch;
const PORTAL = 'https://portal.example.test';
const PHONE = '923002220000';
const TEACHER = {
  id: '60530046-7ac3-4ea3-a976-b43c37c23213', phone_number: PHONE, name: 'T', role: 'teacher',
  preferred_language: 'en', registration_completed: true, registration_state: 'completed',
};
const ENV = {
  TEACHER_TRAINING_FLOW_ID: 'flow-training',
  ASSESSMENT_GEN_FLOW_ID: 'flow-assess',
  STUDENT_VIDEOS_FLOW_ID: 'flow-videos',
  OPENAI_API_KEY: 'test-openai',
  OPENROUTER_API_KEY: 'test-openrouter',
  INTERNAL_API_KEY: 'test-internal-key',
  PORTAL_URL: PORTAL,
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
};
const SCRUBBED = ['LLM_JOB_MODELS', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
  'TRANSCRIPT_QUIZ_ENABLED', 'TRANSCRIPT_QUIZ_FLOW_ID', 'E2E_CASSETTE', 'REDIS_URL'];

// Every registered teacher on the teacher app, the seven IAB features switched to "teachers" — production on 20 Oct.
const IAB_ON = ['menu', 'lesson_plan', 'assessment_generator', 'ai_coaching', 'teacher_training', 'attendance', 'classes']
  .map((f) => ({ key: `app_redirect_${f}`, value: 'teachers' }))
  .concat([{ key: 'portal_teacher_v2', value: 'teachers' }]);

let classifierSays;
let classifierCalls;
let chatCalls;
const saved = {};
let handler;

async function load(settings) {
  jest.resetModules();
  mockDb = makeDb({
    users: [{ ...TEACHER }],
    app_settings: [{ key: 'assessment_generator_enabled', value: true }, ...settings],
    user_feature_first_use: [],
    coaching_sessions: [],
    lesson_plan_requests: [],
  });
  await require('../../bot/shared/config/model-settings').refresh();
  handler = require('../../bot/shared/handlers/text-message.handler');
}

async function say(body) {
  global.__TEST_USER__ = { ...TEACHER };
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, PHONE, body, { ...TEACHER });
  } catch (_) { /* a branch this suite does not stub — the assertions say what mattered */ }
  await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  for (const k of [...SCRUBBED, ...Object.keys(ENV)]) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, ENV);
  classifierSays = 'general';
  classifierCalls = [];
  chatCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/chat\/completions/.test(url)) {
      const system = ((body && body.messages) || []).find((m) => m.role === 'system');
      const isClassifier = Boolean(system && /You are an intent classifier/.test(system.content));
      (isClassifier ? classifierCalls : chatCalls).push(body);
      const content = isClassifier ? classifierSays : 'a warm answer';
      return json({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: (body && body.model) || 'x',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 },
      });
    }
    return json({ ok: true });
  };
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  for (const k of [...SCRUBBED, ...Object.keys(ENV)]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const ctaLinks = () => mockWa.sendCtaUrl.mock.calls.map(([, opts]) => opts.url);
const linkFeature = (url) => {
  const link = require('../../bot/shared/services/app-login-link');
  return link.verifyAppLink(url.slice(`${PORTAL}/go/`.length)).f;
};
const UNSURE = () => resolveUx('menuMatchUnsure', { language: 'en' });
const sentTexts = () => mockWa.sendMessage.mock.calls.map(([, text]) => text);

describe('the production case: a slip of /assessment', () => {
  test.each(['/assesments', '/assesment'])('%s → the Test Paper IAB button, no chat, no classifier', async (typed) => {
    await load(IAB_ON);
    await say(typed);
    expect(ctaLinks()).toHaveLength(1);
    expect(linkFeature(ctaLinks()[0])).toBe('assessment_generator');
    expect(chatCalls).toHaveLength(0);
    expect(classifierCalls).toHaveLength(0);
  });
});

describe('confident → the IAB button for that feature', () => {
  test.each([
    ['assessment', 'assessment_generator'],
    ['training', 'teacher_training'],
    ['attendance', 'attendance'],
    ['coaching', 'ai_coaching'],
  ])('classifier says %s → one IAB button for %s, and nothing else', async (said, feature) => {
    await load(IAB_ON);
    classifierSays = said;
    await say('mujhe woh cheez kholni hai');
    expect(classifierCalls).toHaveLength(1);
    expect(ctaLinks()).toHaveLength(1);
    expect(linkFeature(ctaLinks()[0])).toBe(feature);
    expect(chatCalls).toHaveLength(0);
    expect(sentTexts()).toHaveLength(0);
    // The session type is only ever written with the values it held before.
    for (const [, type] of mockUpdateSessionType.mock.calls) expect(['lesson_plan']).toContain(type);
  });

  test("a coach whose words name Training gets the coach app's Training Library, as /training does", async () => {
    await load([
      { key: 'portal_coach_v2', value: true },
      { key: 'coach_app_training', value: 'coaches' },
    ]);
    const COACH = { ...TEACHER, role: 'coach' };
    mockDb.tables.users = [{ ...COACH }];
    classifierSays = 'training';
    global.__TEST_USER__ = { ...COACH };
    try {
      await handler.handleTextMessage({ id: 'wamid.test' }, PHONE, 'training kholni hai', { ...COACH });
    } catch (_) { /* assertions below */ }
    await new Promise((r) => setImmediate(r));
    expect(ctaLinks()).toHaveLength(1);
    expect(linkFeature(ctaLinks()[0])).toBe('coach_training');
    expect(chatCalls).toHaveLength(0);
  });

  test('a teacher the IAB does not cover gets the same feature on WhatsApp', async () => {
    await load([]); // no app switches: today's WhatsApp doors
    classifierSays = 'assessment';
    await say('mujhe woh cheez kholni hai');
    expect(mockWa.sendCtaUrl).not.toHaveBeenCalled();
    expect(mockWa.sendFlow).toHaveBeenCalledWith(PHONE, expect.objectContaining({ flowId: 'flow-assess' }));
    expect(chatCalls).toHaveLength(0);
  });
});

describe('not sure → say so, then the IAB menu', () => {
  test('classifier says unsure → the not-sure line, then the IAB Home button', async () => {
    await load(IAB_ON);
    classifierSays = 'unsure';
    await say('mujhe woh cheez kholni hai');
    expect(sentTexts()).toEqual([UNSURE()]);
    expect(ctaLinks()).toHaveLength(1);
    expect(linkFeature(ctaLinks()[0])).toBe('menu');
    expect(chatCalls).toHaveLength(0);
  });

  test('she asks for the menu itself → the IAB Home button, without the not-sure line', async () => {
    await load(IAB_ON);
    classifierSays = 'menu';
    await say('Menu');
    expect(sentTexts()).toEqual([]);
    expect(ctaLinks()).toHaveLength(1);
    expect(linkFeature(ctaLinks()[0])).toBe('menu');
    expect(chatCalls).toHaveLength(0);
  });

  test('a feature that is not on HER menu is not opened — not sure, then the menu', async () => {
    await load(IAB_ON); // no quiz Flow on this deployment: the quiz row is not on her menu
    classifierSays = 'quiz';
    await say('mujhe woh cheez kholni hai');
    expect(sentTexts()).toEqual([UNSURE()]);
    expect(linkFeature(ctaLinks()[0])).toBe('menu');
  });

  test('a lone unrecognised /word never reaches chat, even when the model says general', async () => {
    await load(IAB_ON);
    classifierSays = 'general';
    await say('/xyzzy');
    expect(chatCalls).toHaveLength(0);
    expect(sentTexts()).toEqual([UNSURE()]);
    expect(linkFeature(ctaLinks()[0])).toBe('menu');
  });

  test('without the IAB, the not-sure line is followed by the WhatsApp menu', async () => {
    await load([]);
    classifierSays = 'unsure';
    await say('mujhe woh cheez kholni hai');
    expect(sentTexts()[0]).toBe(UNSURE());
    expect(mockWa.sendFeatureMenuCarousel).toHaveBeenCalledTimes(1);
  });
});

describe('a question is still answered by the chat', () => {
  test('general → the AI answer, no button', async () => {
    await load(IAB_ON);
    classifierSays = 'general';
    await say('how do I manage a noisy class?');
    expect(chatCalls.length).toBeGreaterThan(0);
    expect(mockWa.sendCtaUrl).not.toHaveBeenCalled();
    expect(sentTexts()).not.toContain(UNSURE());
  });

  test('"presentation" no longer starts a presentation — she gets her answer instead', async () => {
    await load(IAB_ON);
    classifierSays = 'presentation';
    await say('make slides on the water cycle');
    expect(mockDb.tables.lesson_plan_requests).toHaveLength(0);
    expect(chatCalls.length).toBeGreaterThan(0);
  });
});
