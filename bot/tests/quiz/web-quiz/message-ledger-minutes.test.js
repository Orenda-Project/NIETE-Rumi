'use strict';
/**
 * Teacher minutes beside dollars on the send ledger: a class round costs the teacher about a minute per child asked,
 * one at a time. record({ minutesEach }) passes p_minutes_each to message_ledger_add, the select-then-write
 * fallback writes `minutes`, and web_quiz.msg_sent carries `min` only when there are minutes (so every send without
 * minutes is unchanged: see message-ledger-minutes-golden.test.js). Supabase (an in-memory fake) is the only faked
 * boundary.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const { logToFile } = require('../../../shared/utils/logger');
const Ledger = require('../../../shared/services/quiz/message-ledger');

const CLASS = '55555555-5555-4555-8555-000000000001';
const NOW = new Date(Date.UTC(2026, 9, 15, 10, 0, 0));
const ROUND = { trigger: 'class_round', initiated: 'bot', recipient: 'teacher', classId: CLASS, now: NOW };
const BASE_ARGS = { p_day: '2026-10-15', p_trigger: 'class_round', p_class_id: CLASS, p_initiated: 'bot', p_recipient: 'teacher', p_n: 3, p_usd_each: 0.015 };

let fake;
function seed(rpcError = null) {
  fake = makeFake({ message_ledger: [] });
  supabase.from = fake.from;
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: rpcError };
  Ledger._resetMissing();
  Ledger._resetCap();
}
const sent = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.msg_sent').map(([, d]) => d);
const NO_FN = { code: '42883', message: 'function message_ledger_add does not exist' };

beforeEach(() => { jest.clearAllMocks(); seed(); });

describe('a class round counts the teacher\'s minutes', () => {
  test('the class round caller\'s rate: one minute per child asked', () => {
    expect(Ledger.MINUTES_PER_ROUND_CHILD).toBe(1);
  });

  test('minutesEach 1, count 3 → ONE rpc with p_minutes_each 1; msg_sent carries min 3', async () => {
    expect(await Ledger.record({ ...ROUND, count: 3, minutesEach: Ledger.MINUTES_PER_ROUND_CHILD })).toBe(true);
    expect(fake.rpcs).toEqual([{ name: 'message_ledger_add', args: { ...BASE_ARGS, p_minutes_each: 1 } }]);
    expect(fake.calls).toEqual([]);
    expect(sent()).toEqual([{ trigger: 'class_round', initiated: 'bot', recipient: 'teacher', usd: 0.045, min: 3, cls: null, w: 's' }]);
  });

  test('no function (42883): the fallback inserts minutes 3, then adds to it (3 + 1.5 = 4.5)', async () => {
    seed(NO_FN);
    expect(await Ledger.record({ ...ROUND, count: 3, minutesEach: 1 })).toBe(true);
    expect(fake.calls.filter((c) => c.op === 'insert').map((c) => c.payload)).toEqual([[
      { day: '2026-10-15', trigger: 'class_round', class_id: CLASS, initiated: 'bot', recipient: 'teacher', count: 3, usd: 0.045, minutes: 3 },
    ]]);
    expect(await Ledger.record({ ...ROUND, count: 3, minutesEach: 0.5 })).toBe(true);
    expect(fake.calls.filter((c) => c.op === 'update').map((c) => c.payload)).toEqual([{ count: 6, usd: 0.09, minutes: 4.5 }]);
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ count: 6, usd: 0.09, minutes: 4.5 })]);
    expect(sent().map((e) => e.min)).toEqual([3, 1.5]);
  });

  test('minutes round to 2 places (numeric(10,2)): 0.333 × 3 → 1', async () => {
    await Ledger.record({ ...ROUND, count: 3, minutesEach: 0.333 });
    expect(sent()[0].min).toBe(1);
  });

  test.each([[-1], [NaN], [Infinity], ['2'], [null], [0]])('minutesEach %p → no minutes: the rpc args and the event are the ones without minutes', async (bad) => {
    expect(await Ledger.record({ ...ROUND, count: 3, minutesEach: bad })).toBe(true);
    expect(fake.rpcs).toEqual([{ name: 'message_ledger_add', args: BASE_ARGS }]);
    expect(JSON.stringify(sent()[0])).toBe(JSON.stringify({ trigger: 'class_round', initiated: 'bot', recipient: 'teacher', usd: 0.045, cls: sent()[0].cls, w: 's' }));
  });

  test('the function on the database is still the old one (PGRST202): the send is counted without minutes, logged once', async () => {
    const calls = [];
    supabase.rpc = jest.fn(async (name, args) => {
      calls.push(args);
      return 'p_minutes_each' in args
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.message_ledger_add(...) in the schema cache' } }
        : { data: 3, error: null };
    });
    expect(await Ledger.record({ ...ROUND, count: 3, minutesEach: 1 })).toBe(true);
    expect(await Ledger.record({ ...ROUND, count: 3, minutesEach: 1 })).toBe(true);
    expect(calls).toEqual([{ ...BASE_ARGS, p_minutes_each: 1 }, BASE_ARGS, { ...BASE_ARGS, p_minutes_each: 1 }, BASE_ARGS]);
    expect(logToFile.mock.calls.filter(([m]) => /minutes/.test(m))).toHaveLength(1);
    expect(sent().map((e) => e.min)).toEqual([undefined, undefined]);
  });
});
