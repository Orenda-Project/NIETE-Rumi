'use strict';
/**
 * The send ledger (message-ledger.js): record() upserts the PKT-day message_ledger row (+count, +US$0.015 × count)
 * and logs web_quiz.msg_sent in the same call, so the ledger count equals the msg_sent count per trigger; a
 * bot-initiated send to a family is refused (nothing written, nothing logged). The ledger is written whatever
 * web_quiz_events_v2 says; only msg_sent's v2 envelope depends on it. Supabase and the logger transport are faked.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logToFile } = require('../../../shared/utils/logger');
const { logEvent } = require('../../../shared/utils/structured-logger');
const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const K = require('../../../shared/services/quiz/web-quiz-kid');
const Ledger = require('../../../shared/services/quiz/message-ledger');

const CLASS = '55555555-5555-4555-8555-000000000001';
const V2_ON = [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_events_v2', value: true }];
let db;
const sent = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.msg_sent').map((c) => c[1]);
const failedWrites = () => logToFile.mock.calls.filter((c) => /ledger: write failed/.test(c[0]));

beforeEach(() => {
  jest.clearAllMocks();
  Flags._resetCache();
  K._reset();
  Ledger._reset();
  process.env.WEB_QUIZ_KID_KEY = 'test-only-kid-key-0123456789abcdef0123456789';
  process.env.WEB_QUIZ_KID_KEY_V = '2026';
  db = { app_settings: [...V2_ON], message_ledger: [] };
  Object.assign(supabase, makeFake(db));
});

describe('record', () => {
  test('ledger count = msg_sent events per trigger, on one PKT-day row per (trigger, class, initiated, recipient)', async () => {
    const now = Date.parse('2026-11-03T20:30:00Z'); // 01:30 PKT on 4 Nov
    for (let i = 0; i < 3; i += 1) expect(await Ledger.record({ trigger: 'home_reply' }, { now })).toBe(true);
    await Ledger.record({ trigger: 'bind_reply', initiated: 'user', recipient: 'family' }, { now });
    await Ledger.record({ trigger: 'teacher_queue', classId: CLASS, initiated: 'bot', recipient: 'teacher' }, { now });
    await Ledger.record({ trigger: 'teacher_queue', classId: CLASS, initiated: 'bot', recipient: 'teacher' }, { now });

    const byTrigger = (rows, f) => rows.reduce((a, r) => ({ ...a, [r.trigger]: (a[r.trigger] || 0) + f(r) }), {});
    expect(byTrigger(db.message_ledger, (r) => r.count)).toEqual(byTrigger(sent(), () => 1));
    expect(byTrigger(db.message_ledger, (r) => r.count)).toEqual({ home_reply: 3, bind_reply: 1, teacher_queue: 2 });
    expect(db.message_ledger).toHaveLength(3);
    const home = db.message_ledger.find((r) => r.trigger === 'home_reply');
    expect(home).toMatchObject({ day: '2026-11-04', class_id: null, initiated: 'user', recipient: 'family', count: 3 });
    expect(Number(home.usd)).toBeCloseTo(0.045, 6);
    expect(db.message_ledger.find((r) => r.trigger === 'teacher_queue')).toMatchObject({ class_id: CLASS, count: 2 });
  });

  test('count > 1 adds count and US$0.015 × count; usd on msg_sent matches', async () => {
    expect(await Ledger.record({ trigger: 'guest_reply', count: 2 })).toBe(true);
    expect(await Ledger.record({ trigger: 'guest_reply' })).toBe(true);
    expect(db.message_ledger[0].count).toBe(3);
    expect(Number(db.message_ledger[0].usd)).toBeCloseTo(0.045, 6);
    expect(sent().map((e) => e.usd)).toEqual([0.03, 0.015]);
  });

  test('msg_sent with v2 on: the envelope, trigger, keyed cls, initiated, recipient, usd; no kid, no ukey, no raw class id', async () => {
    await Ledger.record({ trigger: 'teacher_queue', classId: CLASS, initiated: 'bot', recipient: 'teacher' });
    expect(sent()[0]).toEqual({ w: 's', ev_v: 2, kid_v: '2026', kid: null, trigger: 'teacher_queue', cls: K.cls(CLASS), initiated: 'bot', recipient: 'teacher', usd: 0.015 });
    expect(JSON.stringify(sent()[0])).not.toMatch(/55555555/);
    await Ledger.record({ trigger: 'bind_reply', reason: 'stop' });
    expect(sent()[1]).toMatchObject({ trigger: 'bind_reply', reason: 'stop' });
    expect(sent()[1]).not.toHaveProperty('cls');
  });

  test('web_quiz_events_v2 off: the ledger is still written and msg_sent logged, without the v2 envelope', async () => {
    db.app_settings = [{ key: 'web_quiz_hub', value: true }];
    expect(await Ledger.record({ trigger: 'home_reply' })).toBe(true);
    expect(db.message_ledger).toHaveLength(1);
    expect(sent()).toEqual([{ trigger: 'home_reply', initiated: 'user', recipient: 'family', usd: 0.015, w: 's' }]);
  });

  test('bot to family is refused: false, nothing written, nothing counted as sent', async () => {
    expect(await Ledger.record({ trigger: 'home_reply', initiated: 'bot', recipient: 'family' })).toBe(false);
    expect(await Ledger.record({ trigger: 'home_reply', initiated: 'bot' })).toBe(false);
    expect(db.message_ledger).toHaveLength(0);
    expect(sent()).toHaveLength(0);
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/bot-initiated send to a family was refused/), expect.anything());
  });

  test('an unknown trigger, initiator, recipient or a bad count is refused', async () => {
    expect(await Ledger.record({ trigger: 'promo' })).toBe(false);
    expect(await Ledger.record({ trigger: 'home_reply', initiated: 'system' })).toBe(false);
    expect(await Ledger.record({ trigger: 'home_reply', recipient: 'parent' })).toBe(false);
    expect(await Ledger.record({ trigger: 'home_reply', count: 0 })).toBe(false);
    expect(await Ledger.record({ trigger: 'home_reply', count: 1.5 })).toBe(false);
    expect(db.message_ledger).toHaveLength(0);
    expect(sent()).toHaveLength(0);
  });

  test('the ledger table missing: false, never thrown, the miss logged once; the send is still logged (the gap shows)', async () => {
    supabase.from = (t) => {
      if (t !== 'message_ledger') return makeFake(db).from(t);
      const err = { data: null, error: { code: '42P01', message: 'relation "message_ledger" does not exist' } };
      const b = { select: () => b, eq: () => b, is: () => b, limit: () => b, maybeSingle: () => b, insert: () => b, update: () => b, then: (res) => Promise.resolve(err).then(res) };
      return b;
    };
    expect(await Ledger.record({ trigger: 'guest_reply' })).toBe(false);
    expect(await Ledger.record({ trigger: 'guest_reply' })).toBe(false);
    expect(failedWrites()).toHaveLength(1);
    expect(sent()).toHaveLength(2);
  });

  test('recordSend is the same function (alias)', () => {
    expect(Ledger.recordSend).toBe(Ledger.record);
  });
});
