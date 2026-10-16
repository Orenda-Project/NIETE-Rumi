'use strict';
/**
 * DOOR.md §4 — the menu row. `menu_quiz` on an UNKNOWN phone (personaReason first_door / no_student_row) with the door
 * ON: no key → the maker reply (via 'menu') and exactly one row written (quiz_door_teacher); teacher key → the maker
 * reply, no write; child key → the family reply, the door rows byte-identical; capped keyless → family.fallback as
 * plain text (§3.2). Never the chooser from the menu row. Both switches OFF, a KNOWN teacher, a read error, or the
 * module failing at require → today's TranscriptQuizList.showList(user, from, lang, 1), the same arguments.
 * Driven through the REAL MenuService.handleMenuButtonResponse; only the network boundary is faked.
 */
process.env.STUDENT_MODE_ENABLED = 'true';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/database/bot-helpers', () => ({ getOrCreateSession: jest.fn(async () => 'sess-1'), storeConversation: jest.fn(async () => true) }));
jest.mock('../../shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../shared/services/conversation-state.service', () => ({ clearState: jest.fn(async () => true), getState: jest.fn(async () => null), setState: jest.fn(async () => true) }));

const { resolveUx } = require('../../shared/config/ux-strings');
const TranscriptQuizList = require('../../shared/services/quiz/transcript-quiz-list.service');
const MenuService = require('../../shared/services/menu.service');
const Reply = require('../../shared/services/first-touch/door.reply');
const T = require('./_door-turn');
const { UNKNOWN_USER, PHONE, SISTER_ON, OURS_ON, TABLE, firstUse, iso } = require('./door-fixture');

const SAVED = { ...process.env };
const QUIZ_ENV = { TRANSCRIPT_QUIZ_ENABLED: 'true', TRANSCRIPT_QUIZ_FLOW_ID: 'flow-unit' };
let showList;
let makerCta;
beforeEach(() => {
  process.env = { ...SAVED, ...T.ENV, ...QUIZ_ENV };
  jest.clearAllMocks();
  showList = jest.spyOn(TranscriptQuizList, 'showList').mockResolvedValue(true);
  makerCta = jest.fn(async () => ({ sent: true }));
  Reply._deps.makerCta = makerCta;
});
afterEach(() => { showList.mockRestore(); Reply._deps.makerCta = undefined; jest.dontMock('../../shared/services/first-touch/door.menu'); });
afterAll(() => { process.env = SAVED; });

const unknown = (o = {}) => ({ ...UNKNOWN_USER, personaReason: 'no_student_row', ...o });
const tapRow = (user, language = 'en') => MenuService.handleMenuButtonResponse(user, PHONE, 'menu_quiz', language);
const rowsSnapshot = () => JSON.stringify(T.state.fake.db[TABLE]);
const fallbackBi = resolveUx('ftFamilyFallbackBi', { language: 'en' });
const fallbackUr = resolveUx('ftFamilyFallback', { language: 'ur' });
const choosers = () => T.sent().buttons.filter((b) => b.buttons.some((x) => x.id === 'ft_door_teacher'));

test('no key → the maker reply (via menu), exactly one row written (quiz_door_teacher), never the chooser, never showList', async () => {
  T.seed();
  await tapRow(unknown());
  expect(makerCta).toHaveBeenCalledTimes(1);
  expect(makerCta).toHaveBeenCalledWith(expect.objectContaining({ uid: UNKNOWN_USER.id, lang: 'bi', who: 'unknown', via: 'menu' }));
  expect(showList).not.toHaveBeenCalled();
  expect(choosers()).toHaveLength(0);
  expect(T.state.fake.db[TABLE].map((r) => r.feature)).toEqual(['quiz_door_teacher']);
  expect(T.doorEvents()).toEqual([expect.objectContaining({ door: 'menu', verdict: 'unknown', reason: 'no_key', store: 'teacher', reply: 'maker', script: 'none', lang: 'bi' })]);
});

test('no key, no maker module → the door\'s own 3-button maker fallback, one maker_reply on the ledger', async () => {
  Reply._deps.makerCta = null;
  T.seed();
  await tapRow(unknown());
  expect(T.sent().buttons.map((b) => b.buttons.map((x) => x.id).join())).toEqual(['ft_fb_quiz,ft_fb_lp,ft_fb_coach']);
  expect(T.ledgerTriggers()).toEqual(['maker_reply']);
  expect(showList).not.toHaveBeenCalled();
});

test('teacher key → the maker reply, NO write', async () => {
  T.seed({ rows: [firstUse('quiz_door_teacher')] });
  const before = rowsSnapshot();
  await tapRow(unknown({ personaReason: 'first_door' }));
  expect(makerCta).toHaveBeenCalledWith(expect.objectContaining({ via: 'menu' }));
  expect(rowsSnapshot()).toBe(before);
  expect(T.writes()).toEqual([]);
  expect(T.doorEvents()).toEqual([expect.objectContaining({ door: 'menu', verdict: 'teacher', reason: 'teacher_key', store: 'none', reply: 'maker' })]);
});

test('child key → the family reply, the door rows byte-identical, never the maker, never showList', async () => {
  T.seed({ rows: [firstUse('quiz_door_child'), firstUse('quiz_door_asked', { count: 1 })] });
  const before = rowsSnapshot();
  await tapRow(unknown());
  expect(makerCta).not.toHaveBeenCalled();
  expect(showList).not.toHaveBeenCalled();
  expect(T.sent().cta).toHaveLength(1);
  expect(T.sent().cta[0].body).toBe(resolveUx('ftFamilyBodyBi', { language: 'en' }));
  expect(T.sent().cta[0].body).toContain('آپ ٹیچر ہیں؟ ”ٹیچر“ لکھ کر بھیجیں۔');
  expect(T.ledgerTriggers()).toEqual(['family_reply']);
  expect(rowsSnapshot()).toBe(before);
  expect(T.writes()).toEqual([]);
  expect(T.doorEvents()).toEqual([expect.objectContaining({ door: 'menu', verdict: 'child', reason: 'child_key', store: 'none', reply: 'family' })]);
});

test('child key, preferred_language ur → the Urdu family body (DOOR §7.1)', async () => {
  T.seed({ rows: [firstUse('quiz_door_child')] });
  await tapRow(unknown({ preferred_language: 'ur' }), 'ur');
  expect(T.sent().cta[0].body).toBe(resolveUx('ftFamilyBody', { language: 'ur' }));
});

test('capped keyless → family.fallback.bi as plain text (1 family_reply), no write, never the maker, never the chooser', async () => {
  T.seed({ rows: [firstUse('quiz_door_asked', { count: 2 })] });
  const before = rowsSnapshot();
  await tapRow(unknown());
  expect(T.sent().text).toEqual([{ to: PHONE, body: fallbackBi }]);
  expect(T.sent().buttons).toHaveLength(0);
  expect(T.sent().cta).toHaveLength(0);
  expect(makerCta).not.toHaveBeenCalled();
  expect(showList).not.toHaveBeenCalled();
  expect(T.ledgerTriggers()).toEqual(['family_reply']);
  expect(rowsSnapshot()).toBe(before);
  expect(T.doorEvents()).toEqual([expect.objectContaining({ door: 'menu', reason: 'capped', store: 'capped', reply: 'capped_family' })]);
});

test('capped keyless, preferred_language ur → family.fallback (Urdu)', async () => {
  T.seed({ rows: [firstUse('quiz_door_asked', { count: 2 })] });
  await tapRow(unknown({ preferred_language: 'ur' }), 'ur');
  expect(T.sent().text).toEqual([{ to: PHONE, body: fallbackUr }]);
});

test('both OFF → today\'s showList with the same arguments, no key read, no door event', async () => {
  T.seed({ settings: {} });
  const u = unknown();
  await tapRow(u, 'en');
  expect(showList).toHaveBeenCalledTimes(1);
  expect(showList).toHaveBeenCalledWith(u, PHONE, 'en', 1);
  expect(T.keyReads()).toBe(0);
  expect(T.doorEvents()).toEqual([]);
  expect(makerCta).not.toHaveBeenCalled();
});

test('ours OFF, theirs ON → today\'s showList', async () => {
  T.seed({ settings: { ...SISTER_ON } });
  await tapRow(unknown(), 'ur');
  expect(showList).toHaveBeenCalledWith(expect.any(Object), PHONE, 'ur', 1);
  expect(T.keyReads()).toBe(0);
});

test('a KNOWN teacher (personaReason identity), both ON → today\'s showList, byte-identical, no key read', async () => {
  T.seed();
  const u = { ...UNKNOWN_USER, registration_completed: true, personaReason: 'identity' };
  await tapRow(u, 'en');
  expect(showList).toHaveBeenCalledWith(u, PHONE, 'en', 1);
  expect(T.keyReads()).toBe(0);
  expect(T.writes()).toEqual([]);
  expect(T.sent()).toEqual({ buttons: [], cta: [], text: [] });
  expect(makerCta).not.toHaveBeenCalled();
});

test('the key read fails → today\'s showList', async () => {
  T.seed({ throwOn: TABLE });
  await tapRow(unknown());
  expect(showList).toHaveBeenCalledTimes(1);
  expect(makerCta).not.toHaveBeenCalled();
});

test('the quiz row gate still refuses first (quizEnabled off) — the door never reached', async () => {
  T.seed();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'false';
  await tapRow(unknown());
  expect(showList).not.toHaveBeenCalled();
  expect(T.keyReads()).toBe(0);
  expect(makerCta).not.toHaveBeenCalled();
});

test('the door.menu module throws at require → today\'s showList', async () => {
  jest.resetModules();
  jest.doMock('../../shared/services/first-touch/door.menu', () => { throw new Error('boom at require'); });
  const List = require('../../shared/services/quiz/transcript-quiz-list.service');
  const spy = jest.spyOn(List, 'showList').mockResolvedValue(true);
  const Menu = require('../../shared/services/menu.service');
  require('./_door-turn').seed();
  const u = unknown();
  await Menu.handleMenuButtonResponse(u, PHONE, 'menu_quiz', 'en');
  expect(spy).toHaveBeenCalledWith(u, PHONE, 'en', 1);
});
