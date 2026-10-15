'use strict';
/**
 * The send ledger's writes for every trigger, as they were before teacher minutes existed: the rpc arguments
 * (message_ledger_add), the select-then-write fallback's table writes, and the web_quiz.msg_sent payloads. The
 * snapshot was taken on the code before the minutes change; a caller that passes no minutes must stay
 * byte-identical to it. Supabase (an in-memory fake) is the only faked boundary.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const Ledger = require('../../../shared/services/quiz/message-ledger');

const CLASS = '55555555-5555-4555-8555-000000000001';
const NOW = new Date(Date.UTC(2026, 9, 15, 10, 0, 0));
const COMBOS = [['user', 'family'], ['user', 'teacher'], ['bot', 'teacher']];
const SAVED = { ...process.env };

let fake;
function seed(rpcError) {
  fake = makeFake({ message_ledger: [] });
  supabase.from = fake.from;
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: rpcError };
  Ledger._resetMissing();
  Ledger._resetCap();
}
const sent = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.msg_sent').map(([, d]) => d);
// key order too (a snapshot sorts keys): the exact bytes of every rpc call, table write and event
const bytes = () => [...fake.rpcs, ...fake.calls, ...sent()].map((x) => JSON.stringify(x));

beforeEach(() => {
  process.env = { ...SAVED, WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret' };
  jest.clearAllMocks();
});
afterAll(() => { process.env = SAVED; });

describe('every trigger without minutes: the writes and the events are today\'s', () => {
  test.each(Ledger.TRIGGERS)('%s through message_ledger_add', async (trigger) => {
    seed(null);
    const out = [];
    for (const [initiated, recipient] of COMBOS) {
      for (const classId of [null, CLASS]) {
        for (const count of [1, 3]) {
          out.push(await Ledger.record({ trigger, initiated, recipient, classId, count, now: NOW }));
        }
      }
    }
    out.push(await Ledger.record({ trigger, reason: 'home', usdEach: 0.012, now: NOW }));
    expect({ out, rpcs: fake.rpcs, tables: fake.calls, events: sent(), bytes: bytes() }).toMatchSnapshot();
  });

  test.each(Ledger.TRIGGERS)('%s through the select-then-write fallback (no function)', async (trigger) => {
    seed({ code: '42883', message: 'function message_ledger_add does not exist' });
    const out = [];
    for (const [initiated, recipient] of COMBOS) {
      for (const classId of [null, CLASS]) {
        out.push(await Ledger.record({ trigger, initiated, recipient, classId, count: 2, now: NOW }));
        out.push(await Ledger.record({ trigger, initiated, recipient, classId, count: 1, now: NOW }));
      }
    }
    expect({ out, rpcs: fake.rpcs, tables: fake.calls, rows: fake.db.message_ledger.map(({ id, created_at: c, ...r }) => r), events: sent(), bytes: bytes() })
      .toMatchSnapshot();
  });
});
