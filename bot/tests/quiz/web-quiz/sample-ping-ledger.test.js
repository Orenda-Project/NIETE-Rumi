'use strict';
/**
 * The send ledger's one opening for the direct ping: trigger 'sample_ping' is accepted ONLY as a bot-initiated send
 * to a family and ONLY without `phone` (the strict path: the return value is the write result, never "send anyway").
 * Every other trigger keeps the bot→family refusal. A database CHECK that refuses the row (23514, the go-time
 * migration not applied) makes record() false, so the caller sends nothing. capAllows() is the per-phone daily reply
 * cap on its own (the same rule record() runs when it is given a phone). Supabase (an in-memory fake), Redis and the
 * loggers are the only faked boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const counts = new Map();
  return {
    __counts: counts,
    incr: jest.fn(async (k) => { counts.set(k, (counts.get(k) || 0) + 1); return counts.get(k); }),
    expire: jest.fn(async () => true),
  };
});

const { makeFake } = require('./fake-supabase');
const { fixturePhone } = require('./fixture-phone');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const redisService = require('../../../shared/services/cache/railway-redis.service');
const Ledger = require('../../../shared/services/quiz/message-ledger');

const CLASS = '55555555-5555-4555-8555-000000000001';
const PHONE = fixturePhone(1);
const NOW = new Date(Date.UTC(2026, 9, 15, 10, 0, 0));
const PING = { trigger: 'sample_ping', initiated: 'bot', recipient: 'family', classId: CLASS, usdEach: 0.015, now: NOW };

let fake;
function seed(rpcError = null) {
  fake = makeFake({ message_ledger: [], app_settings: [] });
  supabase.from = fake.from;
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: rpcError };
  Ledger._resetMissing();
  Ledger._resetCap();
  redisService.__counts.clear();
}
const events = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);

beforeEach(() => { jest.clearAllMocks(); seed(); });

describe('sample_ping on the ledger', () => {
  test('sample_ping is accepted beside the counted reply triggers, which stay as they were', () => {
    expect(Ledger.SAMPLE_PING).toBe('sample_ping');
    expect(Ledger.TRIGGERS).toEqual(['home_reply', 'bind_reply', 'guest_reply', 'teacher_refusal', 'class_link', 'class_round', 'teacher_queue']);
  });

  test('bot → family, no phone: ONE rpc with exactly these arguments; true; msg_sent{trigger:sample_ping}', async () => {
    expect(await Ledger.record(PING)).toBe(true);
    expect(fake.rpcs).toEqual([{
      name: 'message_ledger_add',
      args: { p_day: '2026-10-15', p_trigger: 'sample_ping', p_class_id: CLASS, p_initiated: 'bot', p_recipient: 'family', p_n: 1, p_usd_each: 0.015 },
    }]);
    expect(events('web_quiz.msg_sent')).toEqual([{ trigger: 'sample_ping', initiated: 'bot', recipient: 'family', usd: 0.015, cls: null, w: 's' }]);
  });

  test('the marketing rate rides through as p_usd_each', async () => {
    expect(await Ledger.record({ ...PING, usdEach: 0.0473 })).toBe(true);
    expect(fake.rpcs[0].args.p_usd_each).toBe(0.0473);
  });

  test('the same call WITH a phone → false, no rpc, no cap counter touched', async () => {
    expect(await Ledger.record({ ...PING, phone: PHONE })).toBe(false);
    expect(fake.rpcs).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(redisService.incr).not.toHaveBeenCalled();
    expect(events('web_quiz.msg_sent')).toEqual([]);
  });

  test.each([
    ['user', 'family'],
    ['bot', 'teacher'],
    ['user', 'teacher'],
  ])('sample_ping as initiated %s → recipient %s → false, no rpc', async (initiated, recipient) => {
    expect(await Ledger.record({ ...PING, initiated, recipient })).toBe(false);
    expect(fake.rpcs).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  test('every OTHER trigger as bot → family is still refused (unchanged), with or without a phone', async () => {
    const others = Ledger.TRIGGERS;
    expect(others).toHaveLength(7);
    for (const trigger of others) {
      expect(await Ledger.record({ ...PING, trigger })).toBe(false);
      expect(await Ledger.record({ ...PING, trigger, phone: PHONE })).toBe(false);
    }
    expect(fake.rpcs).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(redisService.incr).not.toHaveBeenCalled();
  });

  test('the database CHECK refuses the row (23514) → false: nothing is "sent anyway", no msg_sent', async () => {
    seed({ code: '23514', message: 'new row for relation "message_ledger" violates check constraint "message_ledger_no_bot_to_family"' });
    expect(await Ledger.record(PING)).toBe(false);
    expect(fake.rpcs).toHaveLength(1);
    expect(fake.calls.filter((c) => c.op === 'insert' || c.op === 'update')).toEqual([]);
    expect(events('web_quiz.msg_sent')).toEqual([]);
  });

  test('the trigger CHECK refuses it too (23514 on message_ledger_trigger_check) → false', async () => {
    seed({ code: '23514', message: 'new row for relation "message_ledger" violates check constraint "message_ledger_trigger_check"' });
    expect(await Ledger.record(PING)).toBe(false);
    expect(events('web_quiz.msg_sent')).toEqual([]);
  });

  test('a missing table (42P01) → false', async () => {
    seed({ code: '42P01', message: 'relation "message_ledger" does not exist' });
    expect(await Ledger.record(PING)).toBe(false);
  });
});

describe('capAllows: the per-phone daily reply cap on its own', () => {
  test('is exported as a function', () => {
    expect(typeof Ledger.capAllows).toBe('function');
  });

  test('under the cap (default 8) → true for the first 8, counted in Redis under the day key, never the phone', async () => {
    for (let i = 0; i < 8; i += 1) expect(await Ledger.capAllows(PHONE, 'sample_ping', NOW)).toBe(true);
    const keys = [...redisService.__counts.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith(`wq:reply_cap:${Ledger.pktDay(NOW)}:`)).toBe(true);
    expect(keys[0]).not.toContain(PHONE);
    expect(events('web_quiz.reply_capped')).toEqual([]);
  });

  test('over the cap → false and reply_capped{trigger} once per refusal', async () => {
    for (let i = 0; i < 8; i += 1) await Ledger.capAllows(PHONE, 'sample_ping', NOW);
    expect(await Ledger.capAllows(PHONE, 'sample_ping', NOW)).toBe(false);
    expect(events('web_quiz.reply_capped')).toEqual([{ trigger: 'sample_ping', w: 's' }]);
  });

  test('the cap is the app_settings value (2): the third is refused', async () => {
    fake.db.app_settings.push({ key: Ledger.CAP_KEY, value: '2' });
    expect(await Ledger.capAllows(PHONE, 'sample_ping', NOW)).toBe(true);
    expect(await Ledger.capAllows(PHONE, 'sample_ping', NOW)).toBe(true);
    expect(await Ledger.capAllows(PHONE, 'sample_ping', NOW)).toBe(false);
  });

  test('capAllows writes no ledger row and no msg_sent', async () => {
    await Ledger.capAllows(PHONE, 'sample_ping', NOW);
    expect(fake.rpcs).toEqual([]);
    expect(events('web_quiz.msg_sent')).toEqual([]);
  });

  test('record() with a phone shares the same counter: after 8 capAllows, a home_reply record is capped', async () => {
    for (let i = 0; i < 8; i += 1) await Ledger.capAllows(PHONE, 'sample_ping', NOW);
    expect(await Ledger.record({ trigger: 'home_reply', phone: PHONE, now: NOW })).toBe(false);
    expect(events('web_quiz.reply_capped')).toEqual([{ trigger: 'home_reply', w: 's' }]);
  });
});
