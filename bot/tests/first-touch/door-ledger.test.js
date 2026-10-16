'use strict';
/**
 * DOOR.md §9 — every send of the door goes through ONE wrapper: Ledger.record({ trigger, phone, reason,
 * recipient, initiated:'user' }) FIRST, the send only when it returned true. The sister's per-phone daily cap is the
 * only cap (the door adds none): over it nothing is sent and web_quiz.reply_capped{trigger} is logged; with Redis down
 * the cap still holds (the process-local counter). The ledger trigger golden: door_reply, maker_reply and family_reply
 * are in the closed TRIGGERS list, and record() writes one row per PKT day per trigger.
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

const redisService = require('../../shared/services/cache/railway-redis.service');
const VerdictCache = require('../../shared/services/student-ingress-cache');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const Ledger = require('../../shared/services/quiz/message-ledger');
const Reply = require('../../shared/services/first-touch/door.reply');
const T = require('./_door-turn');
const { PHONE, SISTER_ON, OURS_ON, TABLE } = require('./door-fixture');

const SAVED = { ...process.env };
let record;
beforeEach(() => {
  process.env = { ...SAVED, ...T.ENV };
  jest.clearAllMocks();
  record = jest.spyOn(Ledger, 'record');
  Reply._deps.makerCta = undefined;
});
afterEach(() => { record.mockRestore(); Reply._deps.makerCta = undefined; });
afterAll(() => { process.env = SAVED; });

const order = (fn) => fn.mock.invocationCallOrder[0];
const capped = () => T.events('web_quiz.reply_capped');

describe('the ledger is recorded BEFORE the send, on every path of §9.2', () => {
  test('the chooser: door_reply, recipient family, initiated user', async () => {
    T.seed();
    await T.text('quiz');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'door_reply', phone: PHONE, recipient: 'family', initiated: 'user' }));
    expect(order(record)).toBeLessThan(order(WhatsAppService.sendInteractiveButtons));
    expect(T.ledgerTriggers()).toEqual(['door_reply']);
  });

  test('the family reply (cta_url): family_reply, recipient family', async () => {
    T.seed();
    await T.tap('ft_door_child');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'family_reply', phone: PHONE, recipient: 'family', initiated: 'user' }));
    expect(order(record)).toBeLessThan(order(WhatsAppService.sendCtaUrl));
    expect(T.ledgerTriggers()).toEqual(['family_reply']);
  });

  test('the family cta refused (sent:false) → family.fallback text in the same turn, the same ONE record', async () => {
    T.seed();
    WhatsAppService.sendCtaUrl.mockResolvedValueOnce(false);
    await T.tap('ft_door_child');
    expect(record).toHaveBeenCalledTimes(1);
    expect(T.sent().text).toHaveLength(1);
    expect(order(record)).toBeLessThan(order(WhatsAppService.sendMessage));
    expect(T.ledgerTriggers()).toEqual(['family_reply']);
    expect(T.doorEvents()).toEqual([expect.objectContaining({ reply: 'fallback', tap: 'child' })]);
  });

  test('the maker reply\'s own 3-button fallback (no maker cta module): maker_reply, recipient teacher', async () => {
    T.seed();
    Reply._deps.makerCta = jest.fn(() => { throw new Error('absent'); });
    await T.tap('ft_door_teacher');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'maker_reply', phone: PHONE, recipient: 'teacher', initiated: 'user' }));
    expect(order(record)).toBeLessThan(order(WhatsAppService.sendInteractiveButtons));
    expect(T.ledgerTriggers()).toEqual(['maker_reply']);
  });

  test('with the maker cta present, IT records maker_reply (FIRST_QUIZ §10.1): the door records nothing for that send', async () => {
    T.seed();
    Reply._deps.makerCta = jest.fn(async () => ({ sent: true }));
    await T.tap('ft_door_teacher');
    expect(Reply._deps.makerCta).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('the cap is the sister\'s, and it never fails open', () => {
  const CAP1 = { ...SISTER_ON, ...OURS_ON, web_quiz_reply_cap_per_phone: 1 };

  test('over the per-phone cap: nothing sent, web_quiz.reply_capped{family_reply}; the chooser over the cap writes no show', async () => {
    T.seed({ settings: CAP1 });
    await T.text('child');                              // 1 of 1: the family reply goes out
    expect(T.sent().cta).toHaveLength(1);
    jest.clearAllMocks();
    await T.text('quiz');                               // child key → the family reply again: over the cap
    expect(T.sendCount()).toBe(0);
    expect(capped()).toEqual([expect.objectContaining({ trigger: 'family_reply' })]);
    expect(T.doorEvents()).toEqual([expect.objectContaining({ reply: 'capped' })]);
    T.state.fake.db[TABLE] = [];                         // keyless again: the chooser is due, and over the cap
    await VerdictCache.forget(PHONE);                    // (the family verdict was cached 60 s; the cap counter is kept)
    jest.clearAllMocks();
    await T.text('quiz');
    expect(T.sendCount()).toBe(0);
    expect(capped()).toEqual([expect.objectContaining({ trigger: 'door_reply' })]);
    expect(T.doorRows()).toEqual({});                   // no show was made, so none is counted
  });

  test('Redis down: the process-local counter holds the cap (the second reply refused)', async () => {
    T.seed({ settings: CAP1 });
    redisService.incr.mockImplementationOnce(async () => { throw new Error('redis down'); });
    await T.text('child');
    expect(T.sent().cta).toHaveLength(1);
    expect(T.events('web_quiz.reply_cap_unavailable')).toEqual([expect.objectContaining({ why: 'redis_local' })]);
    jest.clearAllMocks();
    redisService.incr.mockImplementationOnce(async () => { throw new Error('redis down'); });
    await T.text('child');
    expect(T.sendCount()).toBe(0);
    expect(capped()).toEqual([expect.objectContaining({ trigger: 'family_reply' })]);
  });
});

describe('the ledger trigger golden: the three names are in the closed list, one row per PKT day per trigger', () => {
  test('TRIGGERS carries door_reply, maker_reply, family_reply (and the sister\'s seven, unchanged)', () => {
    expect(Ledger.TRIGGERS).toEqual(expect.arrayContaining(['home_reply', 'bind_reply', 'guest_reply', 'teacher_refusal', 'class_link', 'class_round', 'teacher_queue', 'door_reply', 'maker_reply', 'family_reply']));
    expect(Ledger.TRIGGERS).toHaveLength(10);
  });

  test.each([['door_reply', 'family'], ['maker_reply', 'teacher'], ['family_reply', 'family']])('%s: record() true; two sends one PKT day = one row of 2; the next PKT day a second row', async (trigger, recipient) => {
    T.seed();
    T.state.fake.rpcResult = { data: null, error: { code: '42883', message: 'function message_ledger_add does not exist' } };
    const day1 = new Date('2026-10-20T06:00:00Z');
    const day2 = new Date('2026-10-20T19:30:00Z');       // 00:30 PKT on the 21st
    expect(await Ledger.record({ trigger, phone: PHONE, recipient, initiated: 'user', now: day1 })).toBe(true);
    expect(await Ledger.record({ trigger, phone: PHONE, recipient, initiated: 'user', now: day1 })).toBe(true);
    expect(await Ledger.record({ trigger, phone: PHONE, recipient, initiated: 'user', now: day2 })).toBe(true);
    const rows = T.state.fake.db.message_ledger.filter((r) => r.trigger === trigger);
    expect(rows.map((r) => [r.day, r.count, r.recipient, r.initiated])).toEqual([['2026-10-20', 2, recipient, 'user'], ['2026-10-21', 1, recipient, 'user']]);
    expect(T.events('web_quiz.msg_sent').filter((e) => e.trigger === trigger)).toHaveLength(3);
  });
});
