'use strict';
/**
 * The send ledger (web-quiz-ledger.js): recordSend() upserts the PKT-day message_ledger row (+1, +US$0.015) and logs
 * web_quiz.msg_sent in the same call, so the ledger count equals the msg_sent count per trigger; a bot-initiated
 * send to a family is refused (nothing written, nothing logged); everything is off unless web_quiz_events_v2 (and
 * its parent web_quiz_hub) is on. Supabase and the logger transport are the faked boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const K = require('../../../shared/services/quiz/web-quiz-kid');
const Ledger = require('../../../shared/services/quiz/web-quiz-ledger');

const CLASS = '55555555-5555-4555-8555-000000000001';
const ON = [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_events_v2', value: true }];
let db;
const sent = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.msg_sent').map((c) => c[1]);

beforeEach(() => {
  jest.clearAllMocks();
  Flags._resetCache();
  K._reset();
  process.env.WEB_QUIZ_KID_KEY = 'test-only-kid-key-0123456789abcdef0123456789';
  process.env.WEB_QUIZ_KID_KEY_V = '2026';
  db = { app_settings: [...ON], message_ledger: [] };
  Object.assign(supabase, makeFake(db));
});

describe('recordSend', () => {
  test('ledger count = msg_sent events per trigger, on one PKT-day row per (trigger, class, initiated, recipient)', async () => {
    const now = Date.parse('2026-11-03T20:30:00Z'); // 01:30 PKT on 4 Nov
    for (let i = 0; i < 3; i += 1) expect(await Ledger.recordSend({ trigger: 'home_reply', initiated: 'user', recipient: 'family' }, { now })).toMatchObject({ recorded: true });
    await Ledger.recordSend({ trigger: 'bind_reply', initiated: 'user', recipient: 'family' }, { now });
    await Ledger.recordSend({ trigger: 'teacher_queue', classId: CLASS, initiated: 'bot', recipient: 'teacher' }, { now });
    await Ledger.recordSend({ trigger: 'teacher_queue', classId: CLASS, initiated: 'bot', recipient: 'teacher' }, { now });

    const byTrigger = (rows, f) => rows.reduce((a, r) => ({ ...a, [r.trigger]: (a[r.trigger] || 0) + f(r) }), {});
    expect(byTrigger(db.message_ledger, (r) => r.count)).toEqual(byTrigger(sent(), () => 1));
    expect(byTrigger(db.message_ledger, (r) => r.count)).toEqual({ home_reply: 3, bind_reply: 1, teacher_queue: 2 });
    expect(db.message_ledger).toHaveLength(3);
    const home = db.message_ledger.find((r) => r.trigger === 'home_reply');
    expect(home).toMatchObject({ day: '2026-11-04', class_id: null, initiated: 'user', recipient: 'family', count: 3 });
    expect(Number(home.usd)).toBeCloseTo(0.045, 6);
    expect(db.message_ledger.find((r) => r.trigger === 'teacher_queue')).toMatchObject({ class_id: CLASS, count: 2 });
  });

  test('msg_sent carries trigger, keyed cls, initiated, recipient, usd — no kid, no ukey, no raw class id', async () => {
    await Ledger.recordSend({ trigger: 'teacher_queue', classId: CLASS, initiated: 'bot', recipient: 'teacher' });
    expect(sent()[0]).toEqual({ w: 's', ev_v: 2, kid_v: '2026', kid: null, trigger: 'teacher_queue', cls: K.cls(CLASS), initiated: 'bot', recipient: 'teacher', usd: 0.015 });
    expect(JSON.stringify(sent()[0])).not.toMatch(/55555555/);
    await Ledger.recordSend({ trigger: 'home_reply', initiated: 'user', recipient: 'family' });
    expect(sent()[1]).not.toHaveProperty('cls');
  });

  test('bot to family is refused: nothing written, nothing counted as sent', async () => {
    const out = await Ledger.recordSend({ trigger: 'home_reply', initiated: 'bot', recipient: 'family' });
    expect(out).toEqual({ recorded: false, reason: 'bot_to_family' });
    expect(db.message_ledger).toHaveLength(0);
    expect(sent()).toHaveLength(0);
  });

  test('an unknown trigger, initiator or recipient is refused', async () => {
    expect(await Ledger.recordSend({ trigger: 'promo', initiated: 'user', recipient: 'family' })).toMatchObject({ recorded: false, reason: 'bad_send' });
    expect(await Ledger.recordSend({ trigger: 'home_reply', initiated: 'system', recipient: 'family' })).toMatchObject({ recorded: false });
    expect(await Ledger.recordSend({ trigger: 'home_reply', initiated: 'user', recipient: 'parent' })).toMatchObject({ recorded: false });
    expect(db.message_ledger).toHaveLength(0);
    expect(sent()).toHaveLength(0);
  });

  test('web_quiz_events_v2 off (or its parent off): nothing written, nothing logged', async () => {
    db.app_settings = [{ key: 'web_quiz_hub', value: true }];
    expect(await Ledger.recordSend({ trigger: 'home_reply', initiated: 'user', recipient: 'family' })).toEqual({ recorded: false, reason: 'off' });
    Flags._resetCache();
    db.app_settings = [{ key: 'web_quiz_events_v2', value: true }];
    expect(await Ledger.recordSend({ trigger: 'home_reply', initiated: 'user', recipient: 'family' })).toEqual({ recorded: false, reason: 'off' });
    expect(db.message_ledger).toHaveLength(0);
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('the ledger table missing: the send is still logged (the count difference shows the gap), never thrown', async () => {
    supabase.from = (t) => {
      if (t !== 'message_ledger') return makeFake(db).from(t);
      const err = { data: null, error: { code: '42P01', message: 'relation "message_ledger" does not exist' } };
      const b = { select: () => b, eq: () => b, is: () => b, limit: () => b, maybeSingle: () => b, insert: () => b, update: () => b, then: (res) => Promise.resolve(err).then(res) };
      return b;
    };
    const out = await Ledger.recordSend({ trigger: 'guest_reply', initiated: 'user', recipient: 'family' });
    expect(out).toMatchObject({ recorded: false, reason: 'store_failed' });
    expect(sent()).toHaveLength(1);
  });
});
