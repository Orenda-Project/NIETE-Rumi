'use strict';
/**
 * DOOR.md §3 — the cap. The SHOW of the chooser writes quiz_door_asked, +1 only when the row was not touched today in
 * PKT (Asia/Karachi, UTC+5); a keyless phone shown the chooser on two PKT days is CAPPED: its next quiz request gets
 * family.fallback as plain text (Arabic script → Urdu; Latin → .bi) through the one wrapper (family_reply), event
 * reply 'capped_family', store 'capped', NO write — never maker.*, never the chooser, never today's teacher home.
 * Fake clock throughout; the real ingress (attach → route); only the network boundary is faked.
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

const { resolveUx } = require('../../shared/config/ux-strings');
const Reply = require('../../shared/services/first-touch/door.reply');
const T = require('./_door-turn');
const { TABLE, firstUse } = require('./door-fixture');

const SAVED = { ...process.env };
const at = (iso) => jest.setSystemTime(new Date(iso));
let makerCta;
beforeEach(() => {
  process.env = { ...SAVED, ...T.ENV };
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
  makerCta = jest.fn(async () => ({ sent: true }));
  Reply._deps.makerCta = makerCta;
});
afterEach(() => { jest.useRealTimers(); Reply._deps.makerCta = undefined; });
afterAll(() => { process.env = SAVED; });

const choosers = () => T.sent().buttons.filter((b) => b.buttons.map((x) => x.id).join() === 'ft_door_teacher,ft_door_child');
const FALLBACK_BI = resolveUx('ftFamilyFallbackBi', { language: 'en' });
const FALLBACK_UR = resolveUx('ftFamilyFallback', { language: 'ur' });
const rows = () => JSON.stringify(T.state.fake.db[TABLE]);

test('(i) two "quiz" on one PKT day (11:00 and 15:00 PKT) → intro_shown_count 1, two chooser sends', async () => {
  T.seed();
  at('2026-10-20T06:00:00Z');
  await T.text('quiz');
  at('2026-10-20T10:00:00Z');
  await T.text('quiz');
  expect(choosers()).toHaveLength(2);
  expect(T.doorRows().quiz_door_asked.count).toBe(1);
});

test('(ii) a third request on another PKT day, keyless (Latin) → family.fallback.bi as plain text, capped_family, no write', async () => {
  T.seed();
  at('2026-10-20T06:00:00Z'); await T.text('quiz');
  at('2026-10-21T06:00:00Z'); await T.text('quiz');
  expect(T.doorRows().quiz_door_asked.count).toBe(2);
  jest.clearAllMocks();
  at('2026-10-23T06:00:00Z');
  const writesBefore = T.writes().length;
  const before = rows();
  const { routed } = await T.text('quiz');
  expect(routed).toBe(true);
  expect(T.sent()).toEqual({ buttons: [], cta: [], text: [{ to: expect.any(String), body: FALLBACK_BI }] });
  expect(T.ledgerTriggers().slice(-1)).toEqual(['family_reply']);
  expect(T.writes().length).toBe(writesBefore);
  expect(rows()).toBe(before);
  expect(makerCta).not.toHaveBeenCalled();
  expect(T.doorEvents()).toEqual([expect.objectContaining({ door: 'text', verdict: 'unknown', reason: 'capped', store: 'capped', reply: 'capped_family', lang: 'bi', script: 'latin' })]);
});

test('(ii′) capped keyless, Arabic script «کوئز» → family.fallback (Urdu)', async () => {
  T.seed({ rows: [firstUse('quiz_door_asked', { count: 2 })] });
  at('2026-10-23T06:00:00Z');
  await T.text('کوئز');
  expect(T.sent().text.map((t) => t.body)).toEqual([FALLBACK_UR]);
  expect(T.sent().buttons).toHaveLength(0);
  expect(T.doorEvents()).toEqual([expect.objectContaining({ reply: 'capped_family', store: 'capped', lang: 'ur', script: 'arabic' })]);
});

test('(ii″) the fallback text names the teacher\'s typed way out, nothing to tap', () => {
  expect(FALLBACK_UR).toContain('آپ ٹیچر ہیں؟ ”ٹیچر“ لکھ کر بھیجیں۔');
  expect(FALLBACK_BI).toContain('Teaching a class? Send “teacher”.');
  expect(FALLBACK_UR).not.toContain('ٹیپ کریں');
});

test('(iii) 23:59 → 00:01 PKT (a PKT midnight between) → intro_shown_count 2', async () => {
  T.seed();
  at('2026-10-20T18:59:00Z'); await T.text('quiz');
  at('2026-10-20T19:01:00Z'); await T.text('quiz');
  expect(choosers()).toHaveLength(2);
  expect(T.doorRows().quiz_door_asked.count).toBe(2);
});

test('(iv) the warm cell: the capped phone 20 s later → the same reply replayed from the 60 s cache, no read, +0', async () => {
  T.seed({ rows: [firstUse('quiz_door_asked', { count: 2 })] });
  at('2026-10-23T06:00:00Z');
  await T.text('quiz');
  const readsCold = T.keyReads();
  const writesCold = T.writes().length;
  const before = rows();
  at('2026-10-23T06:00:20Z');
  await T.text('quiz');
  expect(T.keyReads()).toBe(readsCold);
  expect(T.writes().length).toBe(writesCold);
  expect(rows()).toBe(before);
  expect(T.doorEvents().map((e) => [e.reason, e.store])).toEqual([['capped', 'capped'], ['capped', 'capped']]);
  expect(choosers()).toHaveLength(0);
  expect(makerCta).not.toHaveBeenCalled();
});
