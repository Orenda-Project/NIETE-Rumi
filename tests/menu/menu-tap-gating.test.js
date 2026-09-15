'use strict';
/**
 * Hiding a menu row is COSMETIC. WhatsApp list rows live in scrollback forever
 * — this repo already says so in menu.service, which deliberately keeps the
 * handlers for rows bd-2504 removed. So the role rule has to be enforced where
 * the tap LANDS, not only where the row is drawn: a coach who scrolls up to
 * yesterday's menu and taps "Classroom Coaching" would otherwise still be told
 * "send your classroom recording" and then have it parked (row 122's ending).
 *
 * Locked here:
 *   · a tap the role may not have is refused, in her language, and the feature
 *     is NOT started
 *   · a tap the role may have is passed straight through, untouched
 *   · menu_observe delegates to the EXISTING /observe door — the HITL flow
 *     itself is out of scope and must not be reimplemented here
 */

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendFeatureMenuCarousel: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  storeConversation: jest.fn().mockResolvedValue(true),
  getOrCreateSession: jest.fn().mockResolvedValue('sess-1'),
}));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({
  setState: jest.fn().mockResolvedValue(true),
  clearState: jest.fn().mockResolvedValue(true),
  getState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
  setexWithCeiling: jest.fn().mockResolvedValue(true),
  redis: null,
}));
jest.mock('../../bot/shared/services/lesson-planning.service', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/handlers/observe-command.handler', () => ({
  handleObserveCommand: jest.fn().mockResolvedValue(true),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const ObserveCommand = require('../../bot/shared/handlers/observe-command.handler');
const MenuService = require('../../bot/shared/services/menu.service');

const FROM = '923455201162';
const user = (role) => ({ id: `u-${role}`, role, preferred_language: 'en' });

let dcSpy;
beforeEach(() => {
  jest.clearAllMocks();
  dcSpy = jest.spyOn(MenuService, '_handleClassroomCoachingChoice').mockResolvedValue(true);
});
afterEach(() => dcSpy.mockRestore());

const tap = (role, buttonId) =>
  MenuService.handleMenuButtonResponse(user(role), FROM, buttonId, 'en');

describe('menu_coaching (DC) is gated at the tap', () => {
  test('teacher → allowed', async () => {
    await tap('teacher', 'menu_coaching');
    expect(dcSpy).toHaveBeenCalledTimes(1);
  });

  test('principal → allowed (the row-122 role)', async () => {
    await tap('principal', 'menu_coaching');
    expect(dcSpy).toHaveBeenCalledTimes(1);
  });

  test('coach tapping a scrollback DC row → refused, and DC never starts', async () => {
    await tap('coach', 'menu_coaching');
    expect(dcSpy).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('menu_observe (HITL) is gated at the tap', () => {
  test('coach → handed to the EXISTING /observe door, unchanged', async () => {
    await tap('coach', 'menu_observe');
    expect(ObserveCommand.handleObserveCommand).toHaveBeenCalledTimes(1);
    const [, from, body] = ObserveCommand.handleObserveCommand.mock.calls[0];
    expect(from).toBe(FROM);
    expect(String(body)).toMatch(/^\/observe/);
  });

  test('principal → allowed', async () => {
    await tap('principal', 'menu_observe');
    expect(ObserveCommand.handleObserveCommand).toHaveBeenCalledTimes(1);
  });

  test('teacher tapping a stray HITL row → refused, observe never invoked', async () => {
    await tap('teacher', 'menu_observe');
    expect(ObserveCommand.handleObserveCommand).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('the refusal is a message, never a crash or a silence', () => {
  test('it speaks Urdu to an Urdu user', async () => {
    await MenuService.handleMenuButtonResponse(
      { id: 'u-c', role: 'coach', preferred_language: 'ur' }, FROM, 'menu_coaching', 'ur');
    const [, text] = WhatsAppService.sendMessage.mock.calls[0];
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    expect(/[؀-ۿ]/.test(text)).toBe(true);
  });

  test('a refusal never throws', async () => {
    await expect(tap('coach', 'menu_coaching')).resolves.not.toThrow();
  });
});

/**
 * Language protocol (root CLAUDE.md Rule 20): read `preferred_language`, never
 * the dead `user.language`. `users` has NO `language` column — verified against
 * NIETE prod 2026-09-15:
 *
 *     column users.language does not exist
 *
 * So `user.language || 'en'` at the two menu dispatch sites is ALWAYS 'en', and
 * every menu tap has been handled in English for every teacher who chose Urdu.
 * It silently defeats the bilingual refusals above, which is how it was found.
 *
 * Mock-free route contract: a unit test mocks the dispatcher and cannot see
 * which column the receiver read.
 */
describe('menu dispatch reads the live language column', () => {
  const fs = require('fs');
  const path = require('path');
  const BOT = fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8');

  // A fixed window after the call, NOT a lazy match up to the first ')' — a
  // parenthesis inside an explanatory comment would truncate the capture and
  // make this test lie about what the argument is.
  // A fixed window after the call, NOT a lazy match up to the first ')' — a
  // parenthesis inside an explanatory comment would truncate the capture and
  // make this test lie about what the argument is. Comments are then stripped,
  // because a comment SAYING `user.language` is the opposite of a bug and must
  // not read as one.
  const stripComments = (src) => src.replace(/\/\/[^\n]*/g, '');
  const dispatchArgs = () => [...BOT.matchAll(/MenuService\.handleMenuButtonResponse\(/g)]
    .map((m) => stripComments(BOT.slice(m.index, m.index + 420)));

  test('both menu dispatch sites are found', () => {
    expect(dispatchArgs().length).toBe(2);
  });

  test('neither passes the dead `user.language` column', () => {
    for (const args of dispatchArgs()) expect(args).not.toMatch(/user\.language\b/);
  });

  test('both pass `preferred_language`', () => {
    for (const args of dispatchArgs()) expect(args).toMatch(/user\.preferred_language\b/);
  });
});
