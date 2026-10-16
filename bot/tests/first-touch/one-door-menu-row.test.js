'use strict';
/**
 * The menu's Quiz row (`menu_quiz`) under the one door: ON → the same ONE reply as /quiz (the one door, door 'menu'),
 * so the row can never again bypass the child / coach / unknown routing; OFF → today's
 * direct showList, byte-identical. Real MenuService.handleMenuButtonResponse; its boundaries are faked.
 */
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.TRANSCRIPT_QUIZ_FLOW_ID = 'flow-1';
const { fakeDb } = require('../quiz/teacher-quiz-menu/fake-db');

let mockDb;
jest.mock('../../shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/database/bot-helpers', () => ({ getOrCreateSession: jest.fn(async () => 'sess-1'), storeConversation: jest.fn(async () => true) }));
jest.mock('../../shared/services/conversation-state.service', () => ({ clearState: jest.fn(async () => true), getState: jest.fn(async () => null), setState: jest.fn(async () => true) }));
jest.mock('../../shared/services/app-redirect.service', () => ({ redirectIfFlagged: jest.fn(async () => false) }));
const mockShowList = jest.fn(async () => true);
jest.mock('../../shared/services/quiz/transcript-quiz-list.service', () => ({ showList: (...a) => mockShowList(...a) }));
const mockOpen = jest.fn(async () => 'one_door');
jest.mock('../../shared/services/first-touch/one-door.service', () => ({ reply: (...a) => mockOpen(...a) }));

const MenuService = require('../../shared/services/menu.service');
let OneDoorFlags = null;
try { OneDoorFlags = require('../../shared/services/first-touch/one-door.flags'); } catch (_) { /* the base: no such module */ }

const COACH = { id: 'u-coach', role: 'coach', preferred_language: 'en' };
const FROM = fixturePhone(6);
function world(settings) { mockDb = fakeDb({ app_settings: settings }); if (OneDoorFlags) OneDoorFlags._resetCache(); }

beforeEach(() => { jest.clearAllMocks(); });

test('OFF (absent): the row calls showList directly, exactly as today', async () => {
  world([]);
  await MenuService.handleMenuButtonResponse(COACH, FROM, 'menu_quiz', 'en');
  expect(mockShowList).toHaveBeenCalledWith(COACH, FROM, 'en', 1);
  expect(mockOpen).not.toHaveBeenCalled();
});

test('ON: the row gets the one door\'s ONE reply (door menu) — never showList', async () => {
  world([{ key: 'quiz_one_door', value: 'true' }]);
  await MenuService.handleMenuButtonResponse(COACH, FROM, 'menu_quiz', 'en');
  expect(mockOpen).toHaveBeenCalledWith({ user: COACH, from: FROM, door: 'menu', language: 'en' });
  expect(mockShowList).not.toHaveBeenCalled();
});
