'use strict';
/**
 * DOOR.md §5 — the undo both ways, on an UNKNOWN phone with the door on. The inbound normaliser strips the curly and
 * straight quotes, the guillemets and the bidi controls, NFKC, case-folds and trims, then compares the WHOLE message
 * with COPY M10's words: a child word writes quiz_door_child and sends the family reply, a teacher word writes
 * quiz_door_teacher and sends the maker reply, each followed by forgetDoorVerdict with both phone forms. A sentence
 * is never a word ("I am a child" → today's path). A JUGNU- code and a STOP meet the binder first. The sister's claim
 * phrase (looksLikeTeacherClaim, reused read-only) writes the teacher key and sends the maker reply; /register writes
 * it silently and keeps today's registration reply. The store down on a claim still sends the maker reply.
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

const { UX_STRINGS: UX } = require('../../shared/config/ux-strings');
const StudentIdentity = require('../../shared/services/quiz/student-identity.service');
const Door = require('../../shared/services/first-touch/door.service');
const Reply = require('../../shared/services/first-touch/door.reply');
const FamilyToken = require('../../shared/services/first-touch/family.token');
const T = require('./_door-turn');
const { UNKNOWN_USER, PHONE, TABLE, KID, firstUse } = require('./door-fixture');

const SAVED = { ...process.env };
const EVENT_FIELDS = ['door', 'verdict', 'reason', 'new_phone', 'store', 'reply', 'tap', 'lang', 'script', 'ukey', 'w'].sort();
let makerCta;
let forget;
beforeEach(() => {
  process.env = { ...SAVED, ...T.ENV };
  jest.clearAllMocks();
  makerCta = jest.fn(async () => ({ sent: true }));
  Reply._deps.makerCta = makerCta;
  forget = jest.spyOn(StudentIdentity, 'forgetDoorVerdict');
});
afterEach(() => { forget.mockRestore(); Reply._deps.makerCta = undefined; });
afterAll(() => { process.env = SAVED; });

const familyCta = () => T.sent().cta.filter((c) => /\/f\//.test(c.url));

describe('the normaliser and the whole-message matcher (COPY M10)', () => {
  test.each([
    ['”بچہ“', 'child'], ['"child"', 'child'], ["'child'", 'child'], ['«ٹیچر»', 'teacher'],
    ['⁦ٹیچر⁩', 'teacher'], ['‎teacher', 'teacher'], ['“teacher”', 'teacher'], ['Child!', 'child'],
    ['  BACHA. ', 'child'], ['bachay', 'child'], ['بچے', 'child'], ['استاد', 'teacher'], ['استانی', 'teacher'],
    ['I am a teacher', 'teacher'], ["I'm a teacher", 'teacher'], ['i’m a teacher', null], ['میں ٹیچر ہوں۔', 'teacher'],
    ['میں استاد ہوں', 'teacher'], ['I am a child', null], ['my teacher said', null], ['children', null], ['teacher please', null],
    ['', null], [null, null],
  ])('%j → %s', (text, want) => {
    expect(Door.matchUndo(text)).toBe(want);
  });

  test('the strip runs everywhere in the message, then NFKC, the case-fold and the trailing punctuation', () => {
    expect(Door.normaliseInbound(' ‏”بچہ“۔ ')).toBe('بچہ');
    expect(Door.normaliseInbound('« TEACHER »!')).toBe('teacher');
    expect(Door.normaliseInbound('ｃｈｉｌｄ')).toBe('child');   // full-width folds under NFKC
  });
});

describe('a whole-message undo word on an unknown phone, the door on', () => {
  test.each([
    ['”بچہ“', 'ur', 'arabic'], ['"child"', 'bi', 'latin'], ["'child'", 'bi', 'latin'],
  ])('%j → quiz_door_child written, the family reply (%s), forget with both forms', async (body, lang, script) => {
    T.seed();
    const { routed } = await T.text(body);
    expect(routed).toBe(true);
    expect(Object.keys(T.doorRows())).toEqual(['quiz_door_child']);
    expect(T.doorRows().quiz_door_child.usedAt).toEqual(expect.any(String));
    const [cta] = familyCta();
    expect(familyCta()).toHaveLength(1);
    expect(cta.body).toBe(lang === 'ur' ? UX.ftFamilyBody.ur : UX.ftFamilyBodyBi.ur);
    expect(cta.buttonText).toBe(lang === 'ur' ? UX.ftFamilyBtn.ur : Reply.BI_BUTTONS.family);
    const claims = FamilyToken.verifyFamilyToken(cta.url.split('/f/')[1]);
    expect(claims).toEqual(expect.objectContaining({ k: 'f', uid: UNKNOWN_USER.id, lang }));
    expect(JSON.stringify(claims)).not.toContain(PHONE);
    expect(makerCta).not.toHaveBeenCalled();
    expect(T.sendCount()).toBe(1);
    expect(forget).toHaveBeenCalledWith(PHONE, StudentIdentity.normalisePhone(PHONE));
    const [ev] = T.doorEvents();
    expect(T.doorEvents()).toHaveLength(1);
    expect(ev).toEqual(expect.objectContaining({ door: 'undo', store: 'child', reply: 'family', tap: 'none', lang, script, w: 's' }));
    expect(Object.keys(ev).sort()).toEqual(EVENT_FIELDS);
  });

  test.each([
    ['«ٹیچر»', 'ur', 'arabic'], ['⁦ٹیچر⁩', 'ur', 'arabic'], ['‎teacher', 'bi', 'latin'],
  ])('%j → quiz_door_teacher written, the maker reply (%s), forget with both forms', async (body, lang, script) => {
    T.seed();
    const { routed } = await T.text(body);
    expect(routed).toBe(true);
    expect(Object.keys(T.doorRows())).toEqual(['quiz_door_teacher']);
    expect(makerCta).toHaveBeenCalledTimes(1);
    expect(makerCta).toHaveBeenCalledWith(expect.objectContaining({ uid: UNKNOWN_USER.id, lang, who: 'unknown', via: 'door' }));
    expect(familyCta()).toHaveLength(0);
    expect(forget).toHaveBeenCalledWith(PHONE, StudentIdentity.normalisePhone(PHONE));
    expect(T.doorEvents()).toEqual([expect.objectContaining({ door: 'undo', store: 'teacher', reply: 'maker', tap: 'none', lang, script })]);
  });

  test('a teacher key holder types "child" (the wrong tap undone): the child key is newer, the next "quiz" is the family reply', async () => {
    T.seed({ rows: [firstUse('quiz_door_teacher')] });
    await T.text('"child"');
    jest.clearAllMocks();
    await T.text('quiz');
    expect(familyCta()).toHaveLength(1);
    expect(makerCta).not.toHaveBeenCalled();
  });

  test('"I am a child" is a sentence, not a word: today\'s path, nothing written, nothing of ours sent', async () => {
    T.seed();
    const { routed } = await T.text('I am a child');
    expect(routed).toBe(false);
    expect(T.doorRows()).toEqual({});
    expect(T.sendCount()).toBe(0);
    expect(makerCta).not.toHaveBeenCalled();
    expect(T.doorEvents()).toEqual([]);
  });

  test('the door OFF: the same words are today\'s path (no write, no send, no event)', async () => {
    T.seed({ settings: { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true } });
    for (const body of ['"child"', '«ٹیچر»', 'I am the teacher']) {
      expect((await T.text(body)).routed).toBe(false);
    }
    expect(T.doorRows()).toEqual({});
    expect(T.sendCount()).toBe(0);
    expect(T.doorEvents()).toEqual([]);
  });

  test('a known phone (registered teacher) typing "child" never reaches the door', async () => {
    T.seed();
    const { routed } = await T.text('"child"', { ...UNKNOWN_USER, id: 'u-teacher', registration_completed: true, name: 'Teacher Testwala' });
    expect(routed).toBe(false);
    expect(T.doorRows()).toEqual({});
    expect(T.doorEvents()).toEqual([]);
  });
});

describe('codes and STOP meet the binder first (order golden)', () => {
  test('a JUGNU- code from an unknown phone: the binder answers, our handler is never called', async () => {
    T.seed();
    const handle = jest.spyOn(Door, 'handle');
    const { routed } = await T.text('JUGNU-ABCDE');
    expect(routed).toBe(true);
    expect(handle).not.toHaveBeenCalled();
    expect(T.doorRows()).toEqual({});
    handle.mockRestore();
  });

  test('STOP from the same phone holding a (revoked) binding: the binder answers, our handler is never called', async () => {
    const BindRepo = require('../../shared/services/quiz/child-phone-bindings.repo');
    T.seed({ bindings: [{ id: 'b-1', canonical_id: KID, phone_norm: PHONE, phone_tomb: BindRepo.tombOf(PHONE), via: 'save', confirmed_at: '2026-04-02T00:00:00.000Z',
      bound_at: '2026-04-02T00:00:00.000Z', last_played_at: null, expires_at: '2099-03-31T18:59:59.000Z', revoked_at: '2026-05-01T00:00:00.000Z', revoked_by: 'stop', rebind_of: null }] });
    const handle = jest.spyOn(Door, 'handle');
    const { routed } = await T.text('STOP');
    expect(routed).toBe(true);
    expect(handle).not.toHaveBeenCalled();
    handle.mockRestore();
  });

  test('STOP from a never-bound unknown phone: the binder declines, our handler returns false, nothing of ours', async () => {
    T.seed();
    const handle = jest.spyOn(Door, 'handle');
    const { routed } = await T.text('STOP');
    expect(routed).toBe(false);
    expect(handle).toHaveBeenCalledTimes(1);
    await expect(handle.mock.results[0].value).resolves.toBe(false);
    expect(T.doorRows()).toEqual({});
    expect(T.sendCount()).toBe(0);
    handle.mockRestore();
  });
});

describe('the claim phrase (the sister\'s looksLikeTeacherClaim, read-only) and /register', () => {
  test.each([['I am the teacher'], ['teacher here'], ['میں ایک ٹیچر ہوں']])('%j → quiz_door_teacher, the maker reply, door:claim', async (body) => {
    T.seed();
    const { routed } = await T.text(body);
    expect(routed).toBe(true);
    expect(Object.keys(T.doorRows())).toEqual(['quiz_door_teacher']);
    expect(makerCta).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalledWith(PHONE, StudentIdentity.normalisePhone(PHONE));
    expect(T.doorEvents()).toEqual([expect.objectContaining({ door: 'claim', store: 'teacher', reply: 'maker', tap: 'none' })]);
  });

  test.each([['/register'], ['register'], ['/register now']])('%j → the teacher key written silently; today\'s registration reply (route returns false)', async (body) => {
    T.seed();
    const { routed } = await T.text(body);
    expect(routed).toBe(false);
    expect(Object.keys(T.doorRows())).toEqual(['quiz_door_teacher']);
    expect(T.sendCount()).toBe(0);
    expect(makerCta).not.toHaveBeenCalled();
    expect(T.doorEvents()).toEqual([expect.objectContaining({ door: 'claim', store: 'teacher', reply: 'today' })]);
  });

  test('another slash command is today\'s path: no write', async () => {
    T.seed();
    expect((await T.text('/menu')).routed).toBe(false);
    expect(T.doorRows()).toEqual({});
  });

  test('the store down on a claim: the maker reply is still sent (the escape holds), nothing written', async () => {
    T.seed({ throwOn: TABLE });
    const { routed } = await T.text('I am the teacher');
    expect(routed).toBe(true);
    expect(makerCta).toHaveBeenCalledTimes(1);
    expect(T.state.fake.db[TABLE]).toEqual([]);
    expect(T.doorEvents()).toEqual([expect.objectContaining({ door: 'claim', reply: 'maker' })]);
  });
});
