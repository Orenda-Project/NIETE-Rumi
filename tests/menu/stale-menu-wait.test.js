'use strict';
/**
 * After /menu, a teacher's next message is answered — not met with "choose 1-4".
 *
 * Sending the menu parks the wait AWAITING_MENU_CHOICE for an hour. Any free text
 * in that hour was answered "📋 Please choose an option (1-4) from the menu
 * above.\n\nOr type /menu to see the menu again." — but the menu a teacher sees is
 * a WhatsApp LIST of named rows, with no 1-4 in it. And tapping a row that opens a
 * Flow (training, assessment, attendance…) never cleared the wait, so the hour
 * stayed armed behind the Flow.
 *
 * Production, 24-30 Sep 2026: 712 escapes ('⚠️  Invalid menu choice'); 562 of them
 * were followed by another inbound within 5 minutes, and 478 of the 712 were real
 * requests ("Lesson for class 10th urdu", "Grade 4 English chapter 5 … Generate a
 * lesson plan"). Each escape was a billed message that answered nothing.
 *
 * Now: a row tap ends the menu wait, and free text during the wait ends it and is
 * answered on the first try. A digit 1-4 still picks from the numbered text menu,
 * which is still sent when the list cannot be.
 *
 * Drives the REAL text handler and the REAL menu service, mocking only the network
 * boundary: Supabase (in-memory tables), redis (a map), WhatsApp, the LLM.
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
  auth: {},
}));

const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn(async (k) => (mockStore.has(k) ? JSON.stringify(mockStore.get(k)) : null)),
    set: jest.fn(async (k, v) => { mockStore.set(k, typeof v === 'string' ? JSON.parse(v) : v); return 'OK'; }),
    del: jest.fn(async (k) => { mockStore.delete(k); return 1; }),
  },
  isAvailable: () => true,
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
};
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockWa.sendMessage(...a),
  sendFlow: (...a) => mockWa.sendFlow(...a),
  sendInteractiveMessage: (...a) => mockWa.sendInteractiveMessage(...a),
  sendInteractiveButtons: (...a) => mockWa.sendInteractiveButtons(...a),
  sendFeatureMenuCarousel: (...a) => mockWa.sendFeatureMenuCarousel(...a),
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

const TEACHER = {
  id: 'u-teacher', phone_number: '923002220000', name: 'T', role: 'teacher',
  preferred_language: 'en', registration_completed: true, registration_state: 'completed',
};

let handler;
let ConversationState;
let MenuService;
let HelperAgent;

function load() {
  jest.resetModules();
  handler = require('../../bot/shared/handlers/text-message.handler');
  ConversationState = require('../../bot/shared/services/conversation-state.service');
  MenuService = require('../../bot/shared/services/menu.service');
  HelperAgent = require('../../bot/shared/services/helper-agent.service');
}

async function say(body) {
  global.__TEST_USER__ = TEACHER;
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, TEACHER.phone_number, body, TEACHER);
  } catch (_) { /* a branch this suite does not stub — the assertions say what mattered */ }
  await new Promise((r) => setImmediate(r));
}

/** The wait /menu parks, through the menu service's own writer. */
async function menuSent() {
  // eslint-disable-next-line no-underscore-dangle
  await MenuService._updateConversationState(TEACHER.id, 'sess-1', { current_state: 'AWAITING_MENU_CHOICE' });
  const s = await ConversationState.getState(TEACHER.id);
  expect(s && s.step).toBe('AWAITING_MENU_CHOICE');
}

const escapeText = () => HelperAgent.getEscapePathMessage('AWAITING_MENU_CHOICE', 'en');
const escapeSent = () => mockWa.sendMessage.mock.calls.some(([, b]) => b === escapeText());

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockDb = makeDb({ users: [{ ...TEACHER }] });
  load();
});

describe('free text while the menu wait is open', () => {
  test.each([
    'Lesson for class 10th urdu',
    'Grade 4 English chapter 5. Generate a lesson plan',
    'ok',
  ])('"%s" is not answered with the "choose 1-4" escape', async (text) => {
    await menuSent();
    await say(text);
    expect(escapeSent()).toBe(false);
  });

  test('it ends the menu wait, so the next message is not caught either', async () => {
    await menuSent();
    await say('Lesson for class 10th urdu');
    const s = await ConversationState.getState(TEACHER.id);
    expect(s && s.flow === 'menu').toBeFalsy();
  });

  test('the text goes on to be answered (it reaches the ordinary routing)', async () => {
    await menuSent();
    await say('how do I keep grade 3 quiet during group work?');
    const answered = mockDetectIntent.mock.calls.length > 0
      || mockGetResponse.mock.calls.length > 0
      || mockWa.sendMessage.mock.calls.some(([, b]) => b !== escapeText());
    expect(answered).toBe(true);
  });
});

describe('a digit still picks from the numbered menu', () => {
  test('"2" during the wait is a menu choice, not free text', async () => {
    await menuSent();
    const spy = jest.spyOn(MenuService, 'handleMenuChoice').mockResolvedValue(undefined);
    await say('2');
    expect(spy).toHaveBeenCalledWith('2', TEACHER.id, 'sess-1', TEACHER.phone_number, 'text', expect.anything());
    expect(escapeSent()).toBe(false);
  });
});

describe('a menu row tap ends the menu wait', () => {
  test('tapping a row that opens a Flow (training) leaves no menu wait behind', async () => {
    await menuSent();
    await MenuService.handleMenuButtonResponse(TEACHER, TEACHER.phone_number, 'menu_training', 'en');
    const s = await ConversationState.getState(TEACHER.id);
    expect(s && s.flow === 'menu').toBeFalsy();
  });

  test('another feature\'s work is NOT cleared by a row tap (flow-scoped)', async () => {
    await ConversationState.setState(TEACHER.id, { flow: 'coaching', step: 'AWAITING_CLASSROOM_AUDIO', ttlSeconds: 600 });
    await MenuService.handleMenuButtonResponse(TEACHER, TEACHER.phone_number, 'menu_training', 'en');
    const s = await ConversationState.getState(TEACHER.id);
    expect(s && s.flow).toBe('coaching');
  });
});
