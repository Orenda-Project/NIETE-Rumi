'use strict';
/**
 * STOP's reply and the per-phone reply cap (web-quiz-bind.service.js + message-ledger.js): a STOP that erased at
 * least one binding is answered even when the phone's day is at the cap (a privacy action is never silent); the reply
 * is still counted on the ledger; the exempt reply does not move the cap counter, so the day's bound is the cap plus
 * that one reply. A STOP from a phone with nothing saved stays capped. Every capped reply is counted on the ledger's
 * `capped` column, never on `count`/`usd`. Real binder, real ledger, real repos on the shared fake Supabase; Redis is
 * a Map with a counting incr; the WhatsApp send and the loggers are faked.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    get: jest.fn(async (k) => (keys.has(k) ? keys.get(k) : null)),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
    incr: jest.fn(async (k) => { const v = (Number(keys.get(k)) || 0) + 1; keys.set(k, v); return v; }),
    expire: jest.fn(async () => true),
    isAvailable: () => true,
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendCtaUrl: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true),
  sendFlow: jest.fn(async () => false), sendReaction: jest.fn(async () => true),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const WhatsApp = require('../../../shared/services/whatsapp.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Ledger = require('../../../shared/services/quiz/message-ledger');
const Binder = require('../../../shared/services/quiz/web-quiz-bind.service');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(614);
const KID = 'f0000000-0000-4000-8000-000000000051';
const LIST = 'f0000000-0000-4000-8000-0000000000cc';
const USER = { id: 'u-family', registration_completed: false, registration_state: 'unregistered', name: null, role: 'teacher', preferred_language: 'en' };
const iso = (ms) => new Date(Date.now() + ms).toISOString();
let fake;

function seed({ bindings = [] } = {}) {
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }, { key: 'web_quiz_phone_bind', value: true }],
    students: [{ id: KID, student_name: 'Sana Testwala', phone: null, list_id: LIST, is_active: true, status: 'active', self_reported_class: '3', created_at: iso(-600000) }],
    child_bind_codes: [], child_phone_bindings: bindings, message_ledger: [],
    student_lists: [{ id: LIST, user_id: 't1', class_name: '3', section: 'A', is_active: true }],
    quiz_sessions: [], class_enrollments: [], class_teachers: [],
  }, { uniques: { child_bind_codes: ['code'] } });
  supabase.from = (t) => { const b = fake.from(t); b.or = () => b; return b; };
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: { code: '42883', message: 'function message_ledger_add does not exist' } };
  IdFlags._resetCache(); HubFlags._resetCache();
  Ledger._resetMissing(); Ledger._resetCap();
}
const binding = () => ({ id: 'b-51', canonical_id: KID, phone_norm: PHONE, phone_tomb: 'tomb', via: 'save', bound_at: iso(-86400000),
  confirmed_at: iso(-86400000), last_played_at: null, expires_at: '2027-03-31T18:59:59.000Z', revoked_at: null, revoked_by: null, rebind_of: null, code_id: null });
const sends = () => WhatsApp.sendMessage.mock.calls.length + WhatsApp.sendCtaUrl.mock.calls.length;
const ledger = () => fake.db.message_ledger.map((r) => ({ trigger: r.trigger, count: r.count, capped: r.capped || 0 }));
const capped = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.reply_capped').length;
// spend the phone's day: 8 counted replies through the ledger itself (the cap default is 8)
async function spendTheDay() {
  for (let i = 0; i < 8; i += 1) expect(await Ledger.record({ trigger: 'home_reply', phone: PHONE, reason: 'home' })).toBe(true);
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret-32-bytes!!',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test', WEB_QUIZ_PHONE_HASH_SECRET: 'unit-phone-hash-secret-32-bytes!!' };
  jest.clearAllMocks();
  redis.__keys.clear();
  seed();
});
afterAll(() => { process.env = SAVED; });

describe('STOP is never silent when it erased a binding', () => {
  test('the 9th message of the day is STOP with a binding -> erased AND one reply, on the ledger; the counter unmoved', async () => {
    seed({ bindings: [binding()] });
    await spendTheDay();
    expect(sends()).toBe(0);   // the ledger counts; the senders are the callers
    expect(await Binder.handleStop({ phone: PHONE, user: USER, persona: 'student' })).toEqual({ n: 1, children: 1 });
    expect(fake.db.child_phone_bindings[0]).toMatchObject({ revoked_by: 'stop' });
    expect(sends()).toBe(1);
    expect(ledger()).toEqual(expect.arrayContaining([{ trigger: 'bind_reply', count: 1, capped: 0 }]));
    expect(capped()).toBe(0);
    // the exempt reply did not spend the day further: the next ordinary reply is the first capped one
    expect(await Ledger.record({ trigger: 'home_reply', phone: PHONE, reason: 'home' })).toBe(false);
    expect(capped()).toBe(1);
  });

  test('a STOP with nothing saved as the 9th message stays capped: no reply, nothing erased', async () => {
    await spendTheDay();
    expect(await Binder.handleStop({ phone: PHONE, user: USER, persona: 'student' })).toEqual({ n: 0, children: 0 });
    expect(sends()).toBe(0);
    expect(capped()).toBe(1);
  });

  test('under the cap nothing changes: STOP with a binding -> erased, one reply, counted as today', async () => {
    seed({ bindings: [binding()] });
    expect(await Binder.handleStop({ phone: PHONE, user: USER, persona: 'student' })).toEqual({ n: 1, children: 1 });
    expect(sends()).toBe(1);
    expect(ledger()).toEqual([{ trigger: 'bind_reply', count: 1, capped: 0 }]);
  });
});

describe('cap hits are on the ledger', () => {
  test('a capped reply -> the day\'s row gains capped+1; count and usd unchanged; no send; the event still logged', async () => {
    await spendTheDay();
    const before = fake.db.message_ledger.find((r) => r.trigger === 'home_reply');
    expect(before).toMatchObject({ count: 8 });
    expect(await Ledger.record({ trigger: 'home_reply', phone: PHONE, reason: 'home' })).toBe(false);
    expect(await Ledger.record({ trigger: 'home_reply', phone: PHONE, reason: 'home' })).toBe(false);
    const after = fake.db.message_ledger.find((r) => r.trigger === 'home_reply');
    expect(after).toMatchObject({ count: 8, usd: before.usd, capped: 2 });
    expect(capped()).toBe(2);
    expect(logEvent.mock.calls.filter(([n]) => n === 'web_quiz.msg_sent')).toHaveLength(8);
  });

  test('a capped reply on a trigger with no row yet -> a row with count 0, usd 0, capped 1', async () => {
    await spendTheDay();
    expect(await Ledger.record({ trigger: 'bind_reply', phone: PHONE, reason: 'bind' })).toBe(false);
    expect(fake.db.message_ledger.find((r) => r.trigger === 'bind_reply')).toMatchObject({ count: 0, usd: 0, capped: 1 });
  });
});
