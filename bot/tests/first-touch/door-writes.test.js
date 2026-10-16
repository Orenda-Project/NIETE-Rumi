'use strict';
/**
 * DOOR.md §2 — what the door writes. A Teacher tap, a Child tap and every undo word leave the users row
 * byte-identical (preferred_language included); the only table written is user_feature_first_use (the ledger's own
 * rpc aside); every key write is followed by forgetDoorVerdict with both phone forms; the tap's key is the one the
 * tap names. A quiz-shaped request never rewrites an existing key (read-only on the quiz path).
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

const StudentIdentity = require('../../shared/services/quiz/student-identity.service');
const Reply = require('../../shared/services/first-touch/door.reply');
const T = require('./_door-turn');
const { TABLE, PHONE, firstUse, daysAgo } = require('./door-fixture');

const SAVED = { ...process.env };
let forget;
beforeEach(() => {
  process.env = { ...SAVED, ...T.ENV };
  jest.clearAllMocks();
  Reply._deps.makerCta = jest.fn(async () => ({ sent: true }));
  forget = jest.spyOn(StudentIdentity, 'forgetDoorVerdict');
});
afterEach(() => { forget.mockRestore(); Reply._deps.makerCta = undefined; });
afterAll(() => { process.env = SAVED; });

const usersSnapshot = () => JSON.stringify(T.state.fake.db.users);
const tablesWritten = () => [...new Set(T.writes().map((w) => w.split(':')[1]))];

describe.each([
  ['the Teacher tap', () => T.tap('ft_door_teacher'), 'quiz_door_teacher'],
  ['the Child tap', () => T.tap('ft_door_child'), 'quiz_door_child'],
  ['"child"', () => T.text('child'), 'quiz_door_child'],
  ['"bacha"', () => T.text('bacha'), 'quiz_door_child'],
  ['"bachay"', () => T.text('bachay'), 'quiz_door_child'],
  ['«بچہ»', () => T.text('بچہ'), 'quiz_door_child'],
  ['«بچے»', () => T.text('بچے'), 'quiz_door_child'],
  ['"teacher"', () => T.text('teacher'), 'quiz_door_teacher'],
  ['«ٹیچر»', () => T.text('ٹیچر'), 'quiz_door_teacher'],
  ['«استاد»', () => T.text('استاد'), 'quiz_door_teacher'],
  ['«استانی»', () => T.text('استانی'), 'quiz_door_teacher'],
  ['"I\'m a teacher"', () => T.text("I'm a teacher"), 'quiz_door_teacher'],
  ['«میں استاد ہوں»', () => T.text('میں استاد ہوں'), 'quiz_door_teacher'],
])('%s', (_, turn, key) => {
  test(`writes ${key} only; the users row byte-identical; only user_feature_first_use written; forget with both forms`, async () => {
    T.seed();
    const before = usersSnapshot();
    const { routed } = await turn();
    expect(routed).toBe(true);
    expect(usersSnapshot()).toBe(before);
    expect(T.state.fake.db.users[0].preferred_language).toBe('en');
    expect(tablesWritten()).toEqual([TABLE]);
    expect(Object.keys(T.doorRows())).toEqual([key]);
    const row = T.state.fake.db[TABLE][0];
    expect(row.feature_used_at).toEqual(expect.any(String));   // the upsert ran first, so the UPDATE found its row
    expect(T.writes()).toEqual([`upsert:${TABLE}`, `update:${TABLE}`]);
    expect(forget).toHaveBeenCalledWith(PHONE, StudentIdentity.normalisePhone(PHONE));
  });
});

test('the tap reverses an earlier key (last tap wins): Child then Teacher → the teacher key newer; nothing else written', async () => {
  T.seed({ rows: [firstUse('quiz_door_child', { usedAt: daysAgo(2) })] });
  await T.tap('ft_door_teacher');
  const rows = T.doorRows();
  expect(Object.keys(rows).sort()).toEqual(['quiz_door_child', 'quiz_door_teacher']);
  expect(new Date(rows.quiz_door_teacher.usedAt).getTime()).toBeGreaterThan(new Date(rows.quiz_door_child.usedAt).getTime());
  expect(tablesWritten()).toEqual([TABLE]);
});

test('a quiz-shaped request never rewrites an existing key (teacher key → the maker reply, zero writes)', async () => {
  T.seed({ rows: [firstUse('quiz_door_teacher')] });
  const before = JSON.stringify(T.state.fake.db[TABLE]);
  await T.text('quiz');
  expect(JSON.stringify(T.state.fake.db[TABLE])).toBe(before);
  expect(T.writes()).toEqual([]);
});

test('the chooser SHOW writes quiz_door_asked only (upsert then update), the users row byte-identical', async () => {
  T.seed();
  const before = usersSnapshot();
  await T.text('quiz');
  expect(usersSnapshot()).toBe(before);
  expect(Object.keys(T.doorRows())).toEqual(['quiz_door_asked']);
  expect(T.doorRows().quiz_door_asked.count).toBe(1);
  expect(tablesWritten()).toEqual([TABLE]);
  expect(forget).toHaveBeenCalledWith(PHONE, StudentIdentity.normalisePhone(PHONE));
});
