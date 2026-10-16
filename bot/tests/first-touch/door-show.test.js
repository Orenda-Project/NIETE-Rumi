'use strict';
/**
 * DOOR.md §3.1 / §3.3 — the SHOW of the chooser writes quiz_door_asked, +1 only when the row's feature_used_at is not
 * today in PKT (Asia/Karachi, UTC+5, no DST): two "quiz" on one PKT day (11:00 and 15:00) → intro_shown_count 1 and two
 * chooser sends; 23:59 → 00:01 PKT straddles a PKT midnight → 2. The warm cell: a first_door verdict still cached
 * (60 s) → the chooser re-sent with NO key read and +0. A keyless phone asked on two PKT days is capped: in this
 * change it falls to today's path (the capped reply is the menu-row/cap change's), never a third chooser.
 */
process.env.STUDENT_MODE_ENABLED = 'true';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/database/bot-helpers', () => ({ getOrCreateSession: jest.fn(async () => 'sess-1'), storeConversation: jest.fn(async () => true) }));
jest.mock('../../shared/services/quiz/quiz-session.service', () => ({ getActiveState: jest.fn(async () => null), getPostQuizState: jest.fn(async () => null) }));
jest.mock('../../shared/services/quiz/student-quiz.service', () => ({ open: jest.fn(async () => true), handleButton: jest.fn(async () => true), RETRY_ID: 'sq_retry', CARD_ID: 'sq_card' }));
jest.mock('../../shared/handlers/text-message.handler', () => ({ handleGeneralConversation: jest.fn(), tryChildVideoMenu: jest.fn(async () => true) }));

const VerdictCache = require('../../shared/services/student-ingress-cache');
const Door = require('../../shared/services/first-touch/door.service');
const T = require('./_door-turn');
const { PHONE } = require('./door-fixture');

const SAVED = { ...process.env };
const at = (iso) => jest.setSystemTime(new Date(iso));
beforeEach(() => {
  process.env = { ...SAVED, ...T.ENV };
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterEach(() => { jest.useRealTimers(); });
afterAll(() => { process.env = SAVED; });

const choosers = () => T.sent().buttons.filter((b) => b.buttons.map((x) => x.id).join() === 'ft_door_teacher,ft_door_child');

test('isTodayPKT: the Asia/Karachi calendar date', () => {
  const now = new Date('2026-10-20T18:30:00Z');                       // 23:30 PKT on the 20th
  expect(Door.isTodayPKT('2026-10-19T19:00:00Z', now)).toBe(true);    // 00:00 PKT on the 20th
  expect(Door.isTodayPKT('2026-10-19T18:59:59Z', now)).toBe(false);   // 23:59:59 PKT on the 19th
  expect(Door.isTodayPKT('2026-10-20T19:00:00Z', now)).toBe(false);   // 00:00 PKT on the 21st
  expect(Door.isTodayPKT(null, now)).toBe(false);
  expect(Door.isTodayPKT(new Date('2026-10-20T00:00:00Z'), now)).toBe(true);
});

test('two "quiz" on one PKT day (11:00 and 15:00 PKT) → intro_shown_count 1, two chooser sends', async () => {
  T.seed();
  at('2026-10-20T06:00:00Z');
  await T.text('quiz');
  at('2026-10-20T10:00:00Z');
  await T.text('quiz');
  expect(choosers()).toHaveLength(2);
  expect(T.doorRows().quiz_door_asked.count).toBe(1);
  expect(T.doorEvents().map((e) => [e.reply, e.store])).toEqual([['chooser', 'asked'], ['chooser', 'asked']]);
});

test('23:59 → 00:01 PKT (a PKT midnight between) → intro_shown_count 2, then a third request on a later day is capped: no third chooser', async () => {
  T.seed();
  at('2026-10-20T18:59:00Z');
  await T.text('quiz');
  at('2026-10-20T19:01:00Z');
  await T.text('quiz');
  expect(choosers()).toHaveLength(2);
  expect(T.doorRows().quiz_door_asked.count).toBe(2);
  at('2026-10-22T06:00:00Z');
  const { routed } = await T.text('quiz');
  expect(routed).toBe(false);                     // the capped reply is built by the cap change; here: today's path
  expect(choosers()).toHaveLength(2);
  expect(T.doorRows().quiz_door_asked.count).toBe(2);
});

test('the warm 60 s cell: a first_door chooser verdict still cached → the chooser re-sent, no key read, +0', async () => {
  T.seed();
  at('2026-10-20T06:00:00Z');
  await VerdictCache.set(PHONE, { persona: null, mode: 'unknown', reason: 'first_door', door: 'chooser', language: null, studentClass: null }, 60);
  await T.text('quiz');
  expect(choosers()).toHaveLength(1);
  expect(T.keyReads()).toBe(0);
  expect(T.writes()).toEqual([]);
  expect(T.doorEvents()).toEqual([expect.objectContaining({ reply: 'chooser', store: 'none' })]);
});
