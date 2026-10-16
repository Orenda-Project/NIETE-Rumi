'use strict';
/**
 * DOOR.md §5.3 / §1.5 — the door's ONE call in route(), after bindingWords and before the persona return. Through the
 * real ingress: "hello" (cold: today's 10-minute no_student_row) then "quiz" 30 s later → the chooser (the handler
 * re-reads the door itself for a warm no_student_row); the tap's reply is bilingual; the maker reply goes through the
 * injectable seam Reply._deps.makerCta({ uid, lang, who, via }); with no maker cta module the door's own 3-button
 * fallback (maker.fallback.body.unknown(.bi), ids ft_fb_quiz / ft_fb_lp / ft_fb_coach) goes out, and each of its
 * buttons opens the SAME entry its menu row opens today. A capped verdict gets the plain-text capped reply. A broken
 * door module costs exactly its branch.
 */
process.env.STUDENT_MODE_ENABLED = 'true';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'unit-not-a-key';   // menu.service builds its client at load; never called here
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/database/bot-helpers', () => ({ getOrCreateSession: jest.fn(async () => 'sess-1'), storeConversation: jest.fn(async () => true) }));
jest.mock('../../shared/services/quiz/quiz-session.service', () => ({ getActiveState: jest.fn(async () => null), getPostQuizState: jest.fn(async () => null) }));
jest.mock('../../shared/services/quiz/student-quiz.service', () => ({ open: jest.fn(async () => true), handleButton: jest.fn(async () => true), RETRY_ID: 'sq_retry', CARD_ID: 'sq_card' }));
jest.mock('../../shared/handlers/text-message.handler', () => ({ handleGeneralConversation: jest.fn(), tryChildVideoMenu: jest.fn(async () => true) }));

const { UX_STRINGS: UX } = require('../../shared/config/ux-strings');
const MenuService = require('../../shared/services/menu.service');
const Ingress = require('../../shared/services/student-ingress');
const Door = require('../../shared/services/first-touch/door.service');
const Reply = require('../../shared/services/first-touch/door.reply');
const T = require('./_door-turn');
const { UNKNOWN_USER, PHONE, firstUse } = require('./door-fixture');

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, ...T.ENV };
  jest.clearAllMocks();
  Reply._deps.makerCta = undefined;
});
afterEach(() => { Reply._deps.makerCta = undefined; jest.useRealTimers(); });
afterAll(() => { process.env = SAVED; });

const choosers = () => T.sent().buttons.filter((b) => b.buttons.map((x) => x.id).join() === 'ft_door_teacher,ft_door_child');

test('"hello" cold, then "quiz" 30 s later (a warm 10-minute no_student_row) → the chooser', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
  jest.setSystemTime(new Date('2026-10-20T06:00:00Z'));
  T.seed();
  const hello = await T.text('hello');
  expect(hello.routed).toBe(false);
  expect(hello.user.personaReason).toBe('no_student_row');
  jest.setSystemTime(new Date('2026-10-20T06:00:30Z'));
  const quiz = await T.text('quiz');
  expect(quiz.user.personaReason).toBe('no_student_row');   // the cached verdict
  expect(quiz.routed).toBe(true);
  expect(choosers()).toHaveLength(1);
  expect(T.doorRows().quiz_door_asked.count).toBe(1);
  expect(T.keyReads()).toBeGreaterThanOrEqual(1);
});

test('a tap\'s reply is bilingual: the Child tap → family.body.bi with the bilingual button', async () => {
  T.seed();
  await T.text('کوئز');
  jest.clearAllMocks();
  const { routed } = await T.tap('ft_door_child');
  expect(routed).toBe(true);
  expect(T.sent().cta).toEqual([expect.objectContaining({ body: UX.ftFamilyBodyBi.ur, buttonText: Reply.BI_BUTTONS.family, url: expect.stringMatching(/^https:\/\/quiz\.example\.test\/f\//) })]);
});

test('the maker seam: _deps.makerCta({ uid, lang, who, via }) is the one call; the door sends nothing else', async () => {
  T.seed();
  Reply._deps.makerCta = jest.fn(async () => ({ sent: true }));
  const { routed } = await T.tap('ft_door_teacher');
  expect(routed).toBe(true);
  expect(Reply._deps.makerCta).toHaveBeenCalledTimes(1);
  expect(Reply._deps.makerCta.mock.calls[0][0]).toEqual(expect.objectContaining({ uid: UNKNOWN_USER.id, lang: 'bi', who: 'unknown', via: 'door' }));
  expect(T.sendCount()).toBe(0);
  expect(T.doorEvents()).toEqual([expect.objectContaining({ door: 'text', tap: 'teacher', store: 'teacher', reply: 'maker' })]);
});

test('a teacher key holder\'s "quiz" → makerCta with who:door', async () => {
  T.seed({ rows: [firstUse('quiz_door_teacher')] });
  Reply._deps.makerCta = jest.fn(async () => ({ sent: true }));
  await T.text('quiz');
  expect(Reply._deps.makerCta).toHaveBeenCalledWith(expect.objectContaining({ who: 'door', via: 'door', lang: 'bi' }));
});

test('no maker cta module (today): the door\'s own 3-button fallback, maker_reply, the never-met body', async () => {
  T.seed();
  const { routed } = await T.tap('ft_door_teacher');
  expect(routed).toBe(true);
  const [fb] = T.sent().buttons;
  expect(T.sent().buttons).toHaveLength(1);
  expect(fb.body).toBe(UX.ftMakerFallbackBodyUnknownBi.ur);
  expect(fb.buttons.map((b) => b.id)).toEqual(['ft_fb_quiz', 'ft_fb_lp', 'ft_fb_coach']);
  expect(T.ledgerTriggers()).toEqual(['maker_reply']);
  expect(T.doorEvents()).toEqual([expect.objectContaining({ reply: 'fallback', tap: 'teacher', store: 'teacher' })]);
});

test('the fallback for a teacher key holder in Urdu: maker.fallback.body with the Urdu buttons', async () => {
  T.seed({ rows: [firstUse('quiz_door_teacher')] });
  await T.text('کوئز');
  const [fb] = T.sent().buttons;
  expect(fb.body).toBe(UX.ftMakerFallbackBody.ur);
  expect(fb.buttons.map((b) => b.title)).toEqual([UX.ftMakerFallbackBtn1.ur, UX.ftMakerFallbackBtn2.ur, UX.ftMakerFallbackBtn3.ur]);
});

describe('the fallback\'s buttons open today\'s entries, the same functions the menu rows call', () => {
  test.each([['ft_fb_quiz', 'menu_videos'], ['ft_fb_lp', 'menu_lesson_plan'], ['ft_fb_coach', 'menu_coaching']])('%s → the %s row\'s handler', async (id, row) => {
    T.seed();
    const open = jest.spyOn(MenuService, 'handleMenuButtonResponse').mockImplementation(async () => {});
    const { routed } = await T.tap(id);
    expect(routed).toBe(true);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: UNKNOWN_USER.id }), PHONE, row, 'en');
    expect(T.doorRows()).toEqual({});
    open.mockRestore();
  });
});

test('a capped keyless phone: the capped reply (one plain text), no chooser, no write', async () => {
  T.seed({ rows: [firstUse('quiz_door_asked', { count: 2 })] });
  const { routed } = await T.text('quiz');
  expect(routed).toBe(true);
  expect(T.sendCount()).toBe(1);
  expect(T.sent().text).toHaveLength(1);
  expect(T.writes()).toEqual([]);
});

test('a known phone\'s quiz request never reaches the door\'s replies (registered teacher)', async () => {
  T.seed();
  const { routed } = await T.text('quiz', { ...UNKNOWN_USER, id: 'u-teacher', registration_completed: true, name: 'Teacher Testwala' });
  expect(routed).toBe(false);
  expect(T.sendCount()).toBe(0);
  expect(T.keyReads()).toBe(0);
});

test('a non-quiz, non-word text on an unknown phone with the door on → today\'s dispatch', async () => {
  T.seed();
  expect((await T.text('assalam o alaikum')).routed).toBe(false);
  expect(T.sendCount()).toBe(0);
  expect(T.doorEvents()).toEqual([]);
});

test('the door handler throwing costs only its branch: route() falls through to today\'s', async () => {
  T.seed();
  const handle = jest.spyOn(Door, 'handle').mockImplementation(async () => { throw new Error('broken'); });
  const u = { ...UNKNOWN_USER };
  await Ingress.attach(u, PHONE, { body: 'quiz' });
  await expect(Ingress.route({ message: T.textMessage('quiz'), messageType: 'text', messageBody: 'quiz', from: PHONE, user: u })).resolves.toBe(false);
  handle.mockRestore();
});
