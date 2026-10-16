'use strict';
/**
 * DOOR.md §2.5 — a door key older than 90 days (by feature_used_at) is read as absent, never deleted; between the two
 * keys the newest wins. Through the real ingress, as the reply the phone gets: a 91-day teacher key → the chooser; a
 * child key newer than a teacher key → the family reply; an 89-day teacher key → the maker reply.
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

const Reply = require('../../shared/services/first-touch/door.reply');
const T = require('./_door-turn');
const { TABLE, firstUse, daysAgo } = require('./door-fixture');

const SAVED = { ...process.env };
let makerCta;
beforeEach(() => {
  process.env = { ...SAVED, ...T.ENV };
  jest.clearAllMocks();
  makerCta = jest.fn(async () => ({ sent: true }));
  Reply._deps.makerCta = makerCta;
});
afterEach(() => { Reply._deps.makerCta = undefined; });
afterAll(() => { process.env = SAVED; });

const chooserSent = () => T.sent().buttons.filter((b) => b.buttons.map((x) => x.id).join() === 'ft_door_teacher,ft_door_child');
const familySent = () => T.sent().cta.filter((c) => /\/f\//.test(c.url));

test('a teacher key at 91 days is treated as absent: the chooser, and the old row is never deleted', async () => {
  T.seed({ rows: [firstUse('quiz_door_teacher', { usedAt: daysAgo(91) })] });
  await T.text('quiz');
  expect(chooserSent()).toHaveLength(1);
  expect(makerCta).not.toHaveBeenCalled();
  expect(T.state.fake.db[TABLE].some((r) => r.feature === 'quiz_door_teacher')).toBe(true);
  expect(T.doorEvents()).toEqual([expect.objectContaining({ reply: 'chooser', verdict: 'unknown', reason: 'no_key', store: 'asked' })]);
});

test('a teacher key at 89 days still holds: the maker reply, no write', async () => {
  T.seed({ rows: [firstUse('quiz_door_teacher', { usedAt: daysAgo(89) })] });
  await T.text('quiz');
  expect(makerCta).toHaveBeenCalledWith(expect.objectContaining({ who: 'door', via: 'door' }));
  expect(chooserSent()).toHaveLength(0);
  expect(T.writes()).toEqual([]);
  expect(T.doorEvents()).toEqual([expect.objectContaining({ reply: 'maker', verdict: 'teacher', reason: 'teacher_key', store: 'none' })]);
});

test('a child key newer than a teacher key → the family reply (last tap wins), no write', async () => {
  T.seed({ rows: [firstUse('quiz_door_teacher', { usedAt: daysAgo(5) }), firstUse('quiz_door_child', { usedAt: daysAgo(1) })] });
  await T.text('quiz');
  expect(familySent()).toHaveLength(1);
  expect(makerCta).not.toHaveBeenCalled();
  expect(T.writes()).toEqual([]);
  expect(T.doorEvents()).toEqual([expect.objectContaining({ reply: 'family', verdict: 'child', reason: 'child_key', store: 'none' })]);
});

test('a teacher key newer than a child key → the maker reply', async () => {
  T.seed({ rows: [firstUse('quiz_door_child', { usedAt: daysAgo(5) }), firstUse('quiz_door_teacher', { usedAt: daysAgo(1) })] });
  await T.text('quiz');
  expect(makerCta).toHaveBeenCalledTimes(1);
  expect(familySent()).toHaveLength(0);
});

test('a 91-day child key beside a live teacher key → the maker reply (the expired key is absent)', async () => {
  T.seed({ rows: [firstUse('quiz_door_child', { usedAt: daysAgo(1) }), firstUse('quiz_door_teacher', { usedAt: daysAgo(2) })] });
  T.state.fake.db[TABLE][0].feature_used_at = daysAgo(91);
  await T.text('quiz');
  expect(makerCta).toHaveBeenCalledTimes(1);
});
