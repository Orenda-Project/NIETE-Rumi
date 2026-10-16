'use strict';
/**
 * "Keep my place": a way back from every outcome (web_quiz_bind_way_back, default OFF).
 * The family sends the JUGNU- code from WhatsApp; whatever the binder decides, the chat answers ONCE, and an outcome
 * with a recent code carries the button back to the child's page. The hub's card follows the child × device's newest
 * code, not the browser tab. Real door (student-ingress), real binder, real hub extras; Supabase (in-memory tables
 * that apply filters), Redis (a Map) and the WhatsApp send are the faked boundaries — the phone-binder harness.
 */
process.env.STUDENT_MODE_ENABLED = 'true';

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
    // the raw client some readers use (quiz-session getActiveState): JSON strings in the same Map
    redis: { get: jest.fn(async (k) => (keys.has(k) ? JSON.stringify(keys.get(k)) : null)) },
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendCtaUrl: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
  sendFlow: jest.fn(async () => false),
  sendReaction: jest.fn(async () => true),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redisService = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const WhatsApp = require('../../../shared/services/whatsapp.service');
const { resolveUx, UX_STRINGS } = require('../../../shared/config/ux-strings');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Ingress = require('../../../shared/services/student-ingress');
const StudentQuiz = require('../../../shared/services/quiz/student-quiz.service');
const T = require('../../../shared/services/quiz/web-quiz-token');

const { fixturePhone, maskFixturePhones } = require('./fixture-phone');
const PHONE = fixturePhone(611);
const KIDS = ['f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000003',
  'f0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000006'];
const NAMES = ['Ayesha Testwala', 'Bilal Testwala', 'Chanda Testwala', 'Danish Testwala', 'Erum Testwala', 'Faraz Testwala'];
const UNKNOWN_USER = { id: 'u-family', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en' };
const TEACHER_USER = { ...UNKNOWN_USER, id: 'u-teacher', registration_completed: true, name: 'Teacher Testwala' };
const ON = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true };
const WAY_BACK = 'web_quiz_bind_way_back';
const FIXED_NOW = Date.UTC(2026, 9, 15, 10, 0, 0);

let fake;
const iso = (ms) => new Date(ms).toISOString();
const student = (i, extra = {}) => ({ id: KIDS[i], student_name: NAMES[i], phone: null, list_id: 'list-1', is_active: true,
  status: 'active', self_reported_class: '3', created_at: iso(Date.now() - (10 - i) * 60000), ...extra });
const chatKid = (i) => student(i, { phone: PHONE, list_id: null });
const code = (c, kid, extra = {}) => ({ code: c, canonical_id: kid, minted_at: iso(Date.now() - 60000),
  expires_at: iso(Date.now() + 59 * 60000), used_at: null, outcome: null, ...extra });
const binding = (kid, phone = PHONE, extra = {}) => ({ id: `b-${kid.slice(-2)}-${phone.slice(-3)}`, canonical_id: kid, phone_norm: phone,
  phone_tomb: 'tomb', via: 'save', bound_at: iso(Date.now() - 86400000), expires_at: '2027-03-31T18:59:59.000Z',
  revoked_at: null, revoked_by: null, ...extra });

function seed({ on = true, students = [], codes = [], bindings = [], ledger, classTeachers = [] } = {}) {
  const db = {
    app_settings: Object.entries(on ? ON : { web_quiz_hub: true }).map(([key, value]) => ({ key, value })),
    students, child_bind_codes: codes, child_phone_bindings: bindings,
    quiz_sessions: [], class_enrollments: [], student_lists: [], class_teachers: classTeachers,
  };
  if (ledger !== false) db.message_ledger = [];
  fake = makeFake(db, { uniques: { child_bind_codes: ['code'] } });
  supabase.from = (t) => { const b = fake.from(t); b.or = () => b; return b; };
  supabase.rpc = fake.rpc;
  // the ledger's rpc (message_ledger_add) is absent unless a test scripts it: 42883 → the select-then-write path
  fake.rpcResult = { data: null, error: { code: '42883', message: 'function message_ledger_add does not exist' } };
  IdFlags._resetCache();
  HubFlags._resetCache();
  const Ledger = require('../../../shared/services/quiz/message-ledger');
  if (typeof Ledger._resetCap === 'function') Ledger._resetCap();
}
const events = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);
const inserts = (table) => fake.calls.filter((c) => c.table === table && c.op === 'insert');
const reads = (table) => fake.calls.filter((c) => c.table === table);
const sends = () => WhatsApp.sendMessage.mock.calls.length + WhatsApp.sendCtaUrl.mock.calls.length;
const say = async (body, user = { ...UNKNOWN_USER }) => {
  await Ingress.attach(user, PHONE, { body });
  return Ingress.route({ messageType: 'text', messageBody: body, from: PHONE, user });
};

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test' };
  jest.clearAllMocks();
  redisService.__keys.clear();
  seed();
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { process.env = SAVED; });

const BindPage = require('../../../shared/services/quiz/web-quiz-bind-page');
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const H = 3600 * 1000;
/** the way-back switch on (or set to `value`) on top of seed(); its 30 s cache dropped (absent before this change) */
const resetWayBack = () => { try { require('../../../shared/services/quiz/web-quiz-bind-way-back')._resetCache(); } catch (_) { /* not built yet */ } };
function wayBack(value = true) {
  fake.db.app_settings.push({ key: WAY_BACK, value });
  resetWayBack();
}
beforeEach(resetWayBack);
const cta = () => WhatsApp.sendCtaUrl.mock.calls;
const pageIds = (call) => T.verify(call[1].url.split('/h/')[1], 'h').ids;
const OPEN_BTN = 'Open my page';

describe('every outcome answers the chat once (switch on)', () => {
  test('a teacher\'s phone: the teacher line WITH the button back to the child\'s page; ledger teacher_refusal', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    wayBack();
    expect(await say('Jugnu ✨ keep my place JUGNU-AB2CD', { ...TEACHER_USER })).toBe(true);
    expect(fake.db.child_phone_bindings).toHaveLength(0);
    expect(fake.db.child_bind_codes[0].outcome).toBe('teacher_phone');
    expect(sends()).toBe(1);
    expect(cta()).toHaveLength(1);
    expect(cta()[0][0]).toBe(PHONE);
    expect(cta()[0][1].body).toBe(UX_STRINGS.jugnuBindTeacherRefused.en);
    expect(cta()[0][1].buttonText).toBe(OPEN_BTN);
    expect(pageIds(cta()[0])).toEqual([KIDS[0]]);
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ trigger: 'teacher_refusal', recipient: 'teacher', count: 1 })]);
  });

  test('code_expired: the "code too old" line with the button back (the code was minted for this child today)', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0], { minted_at: iso(Date.now() - 2 * H), expires_at: iso(Date.now() - H) })] });
    wayBack();
    expect(await say('JUGNU-AB2CD')).toBe(true);
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'code_expired', w: 's' }]);
    expect(cta()).toHaveLength(1);
    expect(cta()[0][1].body).toBe(UX_STRINGS.jugnuBindCodeOld.en);
    expect(pageIds(cta()[0])).toEqual([KIDS[0]]);
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ trigger: 'bind_reply', count: 1 })]);
  });

  test('already saved: the family sends the same code twice → the saved reply again, not a refusal line', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    wayBack();
    await say('JUGNU-AB2CD');
    jest.clearAllMocks();
    expect(await say('JUGNU-AB2CD')).toBe(true);
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'code_used', w: 's' }]);
    expect(sends()).toBe(1);
    expect(cta()[0][1].body).toBe(resolveUx('jugnuBindSaved', { language: 'en', params: { name: 'Ayesha' } }));
    expect(pageIds(cta()[0])).toEqual([KIDS[0]]);
  });

  test('code_used by another phone: the "code too old or used" line with the button back', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0], { used_at: iso(Date.now() - 1000), outcome: 'bound' })],
      bindings: [binding(KIDS[0], fixturePhone(702))] });
    wayBack();
    await say('JUGNU-AB2CD');
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'code_used', w: 's' }]);
    expect(cta()).toHaveLength(1);
    expect(cta()[0][1].body).toBe(UX_STRINGS.jugnuBindCodeOld.en);
  });

  test('code_unknown (a typo): ONE line saying how to get a new code, no button (no child is known)', async () => {
    seed({ students: [student(0)] });
    wayBack();
    expect(await say('JUGNU-ZZ2ZZ')).toBe(true);
    expect(WhatsApp.sendMessage.mock.calls).toEqual([[PHONE, UX_STRINGS.jugnuBindCodeUnknown.en]]);
    expect(cta()).toHaveLength(0);
  });

  test('child_unknown: the same line, and never a link to an inactive child\'s page', async () => {
    seed({ students: [student(0, { is_active: false })], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    wayBack();
    await say('JUGNU-AB2CD');
    expect(WhatsApp.sendMessage.mock.calls).toEqual([[PHONE, UX_STRINGS.jugnuBindCodeUnknown.en]]);
    expect(cta()).toHaveLength(0);
  });

  test('max_phones: the three-phones line with the button back', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])],
      bindings: [fixturePhone(701), fixturePhone(702), fixturePhone(703)].map((p) => binding(KIDS[0], p)) });
    wayBack();
    await say('JUGNU-AB2CD');
    expect(cta()).toHaveLength(1);
    expect(cta()[0][1].body).toBe(UX_STRINGS.jugnuBindPhonesRefused.en);
    expect(inserts('child_phone_bindings')).toHaveLength(0);
  });

  test('max_kids: the full line now carries the button back too', async () => {
    seed({ students: [0, 1, 2, 3].map(chatKid).concat(student(4)), codes: [code('JUGNU-AB2CD', KIDS[4])] });
    wayBack();
    await say('JUGNU-AB2CD');
    expect(WhatsApp.sendMessage).not.toHaveBeenCalled();
    expect(cta()).toHaveLength(1);
    expect(cta()[0][1].body).toBe(UX_STRINGS.jugnuBindFullRefused.en);
  });

  test('a code minted more than a day ago: the line, no button', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0], { minted_at: iso(Date.now() - 30 * H), expires_at: iso(Date.now() - 29 * H) })] });
    wayBack();
    await say('JUGNU-AB2CD');
    expect(WhatsApp.sendMessage.mock.calls).toEqual([[PHONE, UX_STRINGS.jugnuBindCodeOld.en]]);
    expect(cta()).toHaveLength(0);
  });

  test('the per-phone daily cap still holds: at the cap, nothing is sent and reply_capped is logged', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0]), code('JUGNU-AB2CE', KIDS[0])] });
    wayBack();
    fake.db.app_settings.push({ key: 'web_quiz_reply_cap_per_phone', value: 1 });
    expect(await say('JUGNU-AB2CE', { ...TEACHER_USER })).toBe(true);   // the day's one reply
    jest.clearAllMocks();
    expect(await say('JUGNU-AB2CD', { ...TEACHER_USER })).toBe(true);
    expect(sends()).toBe(0);
    expect(events('web_quiz.reply_capped')).toEqual([{ trigger: 'teacher_refusal', w: 's' }]);
  });

  test('Urdu prefill → the Urdu line and the Urdu button', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    wayBack();
    await say('جگنو ✨ میری جگہ محفوظ کریں JUGNU-AB2CD', { ...TEACHER_USER });
    expect(cta()[0][1].body).toBe(UX_STRINGS.jugnuBindTeacherRefused.ur);
    expect(cta()[0][1].buttonText).toBe(UX_STRINGS.jugnuBindOpenBtn.ur);
  });
});

describe('goldens: switch off (absent or false) → today\'s replies, byte for byte', () => {
  for (const value of [null, false]) {
    const label = value === null ? 'absent' : 'false';
    test(`${label}: teacher → the plain line; the five silent refusals stay silent; max_kids → the plain line`, async () => {
      const run = async (seedArgs, body, user) => {
        seed(seedArgs);
        resetWayBack();
        if (value !== null) wayBack(value);
        jest.clearAllMocks();
        redisService.__keys.clear();
        expect(await say(body, user)).toBe(true);
        return [WhatsApp.sendMessage.mock.calls.slice(), WhatsApp.sendCtaUrl.mock.calls.slice()];
      };
      expect(await run({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])] }, 'JUGNU-AB2CD', { ...TEACHER_USER }))
        .toEqual([[[PHONE, UX_STRINGS.jugnuBindTeacherRefused.en]], []]);
      expect(await run({ students: [student(0)] }, 'JUGNU-ZZ2ZZ')).toEqual([[], []]);
      expect(await run({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0], { used_at: iso(Date.now() - 1000), outcome: 'bound' })] }, 'JUGNU-AB2CD')).toEqual([[], []]);
      expect(await run({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0], { expires_at: iso(Date.now() - 1000) })] }, 'JUGNU-AB2CD')).toEqual([[], []]);
      expect(await run({ students: [student(0, { is_active: false })], codes: [code('JUGNU-AB2CD', KIDS[0])] }, 'JUGNU-AB2CD')).toEqual([[], []]);
      expect(await run({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])], bindings: [701, 702, 703].map((n) => binding(KIDS[0], fixturePhone(n))) }, 'JUGNU-AB2CD')).toEqual([[], []]);
      expect(await run({ students: [0, 1, 2, 3].map(chatKid).concat(student(4)), codes: [code('JUGNU-AB2CD', KIDS[4])] }, 'JUGNU-AB2CD'))
        .toEqual([[[PHONE, UX_STRINGS.jugnuBindFullRefused.en]], []]);
    });
  }
});

describe('the hub card follows the child × device, not the browser tab', () => {
  const extras = async () => {
    const token = T.signHub([KIDS[0]], 'home');
    const out = { kid: T.chipId('h', KIDS[0]), kids: [] };
    return BindPage.hubExtras(out, { token, chosen: { id: KIDS[0], student_name: NAMES[0] }, rows: [student(0)], trust: {}, lang: 'en', device: DEV, src: 'home' });
  };
  const today = async () => ({ offer: true, hub: T.signHub([KIDS[0]], 'home'), kid: T.chipId('h', KIDS[0]) });

  test('the place was saved from this device → no card (the older link no longer asks again)', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0], { device_ref: DEV, used_at: iso(Date.now() - H), outcome: 'bound' })],
      bindings: [binding(KIDS[0], PHONE, { code_id: 'JUGNU-AB2CD' })] });
    wayBack();
    expect((await extras()).bind).toEqual({ offer: false, state: 'bound' });
  });

  test('saved, then undone (no active binding from that code) → today\'s card', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0], { device_ref: DEV, used_at: iso(Date.now() - H), outcome: 'bound' })],
      bindings: [binding(KIDS[0], PHONE, { code_id: 'JUGNU-AB2CD', revoked_at: iso(Date.now() - 1000), revoked_by: 'page_undo' })] });
    wayBack();
    expect((await extras()).bind).toEqual(await today());
  });

  test('refused as a teacher\'s phone from this device in the last week → no card', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0], { device_ref: DEV, used_at: iso(Date.now() - 2 * H), outcome: 'teacher_phone' })] });
    wayBack();
    expect((await extras()).bind).toEqual({ offer: false, state: 'refused', reason: 'teacher_phone' });
  });

  test('a refusal older than a week, an expired code, another device\'s code, or none → today\'s card', async () => {
    const cases = [
      [code('JUGNU-AB2CD', KIDS[0], { device_ref: DEV, used_at: iso(Date.now() - 8 * 24 * H), outcome: 'teacher_phone' })],
      [code('JUGNU-AB2CD', KIDS[0], { device_ref: DEV, used_at: iso(Date.now() - H), outcome: 'code_expired' })],
      [code('JUGNU-AB2CD', KIDS[0], { device_ref: 'BBBBBBBBBBBBBBBBBBBBBB', used_at: iso(Date.now() - H), outcome: 'teacher_phone' })],
      [],
    ];
    for (const codes of cases) {
      seed({ students: [student(0)], codes });
      wayBack();
      expect((await extras()).bind).toEqual(await today());
    }
  });

  test('golden: switch off → today\'s `bind`, deep-equal, and the codes table is never read for it', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0], { device_ref: DEV, used_at: iso(Date.now() - H), outcome: 'bound' })],
      bindings: [binding(KIDS[0], PHONE, { code_id: 'JUGNU-AB2CD' })] });
    expect((await extras()).bind).toEqual(await today());
    expect(reads('child_bind_codes')).toHaveLength(0);
  });

  test('status: with the switch on the answer says so (`wb`), so the page can offer a way back; off → today\'s answer', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0], { used_at: iso(Date.now() - 1000), outcome: 'code_used' })] });
    expect(await BindPage.status({ code: 'JUGNU-AB2CD' })).toEqual({ state: 'refused', reason: 'code_used' });
    wayBack();
    expect(await BindPage.status({ code: 'JUGNU-AB2CD' })).toEqual({ state: 'refused', reason: 'code_used', wb: true });
  });
});

describe('copy', () => {
  test('every new line has en and ur; no test words; the button stays ≤ 20 code points', () => {
    for (const k of ['jugnuBindPhonesRefused', 'jugnuBindCodeOld', 'jugnuBindCodeUnknown']) {
      expect(typeof UX_STRINGS[k].en).toBe('string');
      expect(typeof UX_STRINGS[k].ur).toBe('string');
      expect(`${UX_STRINGS[k].en} ${UX_STRINGS[k].ur}`).not.toMatch(/\btest\b|\bexam\b|assessment|امتحان|ٹیسٹ/i);
    }
    expect([...UX_STRINGS.jugnuBindOpenBtn.ur].length).toBeLessThanOrEqual(20);
  });
});
