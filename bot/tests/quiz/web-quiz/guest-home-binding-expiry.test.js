'use strict';
/**
 * Binding expiry (the daily job's function) and the guest home for an unknown phone's /quiz.
 * Real door (student-ingress), real /quiz open, real stores and token module; Supabase (in-memory tables that apply
 * filters), Redis (a Map) and the WhatsApp send are the faked boundaries.
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
    isAvailable: () => true,
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
const { logToFile } = require('../../../shared/utils/logger');
const WhatsApp = require('../../../shared/services/whatsapp.service');
const { resolveUx, UX_STRINGS } = require('../../../shared/config/ux-strings');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Ingress = require('../../../shared/services/student-ingress');
const StudentQuiz = require('../../../shared/services/quiz/student-quiz.service');
const BindRepo = require('../../../shared/services/quiz/child-phone-bindings.repo');
const T = require('../../../shared/services/quiz/web-quiz-token');

const PHONE = '920000000811';
const PHONE_2 = '920000000812';
const KIDS = ['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003'];
const UNKNOWN_USER = { id: 'u-guest', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en' };
const TEACHER_USER = { ...UNKNOWN_USER, id: 'u-teacher', registration_completed: true, name: 'Teacher Testwala' };
const BIND_ON = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true };
const GUEST_ON = { ...BIND_ON, web_quiz_guest_home: true };
// Test-only stand-ins for the two copy keys not written yet (never shipped: added and removed per test).
const STAND_IN = { guestHome: { en: 'guest body (stand-in)', ur: 'guest body ur (stand-in)' }, guestHomeBtn: { en: 'Play', ur: 'Play ur' } };

let fake;
const iso = (ms) => new Date(ms).toISOString();
const row = (kid, phone, extra = {}) => ({ id: `b-${kid.slice(-2)}-${String(phone).slice(-3)}`, canonical_id: kid, phone_norm: phone,
  phone_tomb: BindRepo.tombOf(phone || PHONE), via: 'save', confirmed_at: '2026-04-02T00:00:00.000Z', bound_at: '2026-04-02T00:00:00.000Z',
  last_played_at: null, expires_at: '2027-03-31T18:59:59.000Z', revoked_at: null, revoked_by: null, rebind_of: null, ...extra });

function seed({ settings = BIND_ON, bindings = [], students = [] } = {}) {
  fake = makeFake({
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    students, child_phone_bindings: bindings, quiz_sessions: [], class_enrollments: [], student_lists: [], message_ledger: [],
  }, { uniques: {} });
  supabase.from = (t) => { const b = fake.from(t); b.or = () => b; return b; };
  supabase.rpc = fake.rpc;
  // the ledger's rpc (message_ledger_add) is absent: 42883 → its select-then-write path, so the row is visible here
  fake.rpcResult = { data: null, error: { code: '42883', message: 'function message_ledger_add does not exist' } };
  IdFlags._resetCache();
  HubFlags._resetCache();
}
const events = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);
const writes = () => fake.calls.filter((c) => c.op !== 'select');
const sends = () => WhatsApp.sendMessage.mock.calls.length + WhatsApp.sendCtaUrl.mock.calls.length;
const say = async (body, user = { ...UNKNOWN_USER }, phone = PHONE) => {
  await Ingress.attach(user, phone);
  return Ingress.route({ messageType: 'text', messageBody: body, from: phone, user });
};
const withStandInCopy = () => Object.assign(UX_STRINGS, STAND_IN);

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test' };
  jest.clearAllMocks();
  redisService.__keys.clear();
  delete UX_STRINGS.guestHome;
  delete UX_STRINGS.guestHomeBtn;
  seed();
});
afterEach(() => { jest.restoreAllMocks(); delete UX_STRINGS.guestHome; delete UX_STRINGS.guestHomeBtn; });
afterAll(() => { process.env = SAVED; });

// ─── expiry ──────────────────────────────────────────────────────────────────

describe('expireBindings(now)', () => {
  const Expiry = () => require('../../../shared/services/quiz/web-quiz-bind-expiry');

  test('expiry erases phone_norm and leaves only phone_tomb (revoked_by expiry, revoked_at = now)', async () => {
    const tomb = BindRepo.tombOf(PHONE);
    seed({ bindings: [row(KIDS[0], PHONE, { expires_at: '2026-03-31T18:59:59.000Z' })] });
    const now = new Date('2026-04-01T02:00:00.000Z');
    const out = await Expiry().expireBindings(now);
    expect(out).toEqual({ expired: 1, deleted: 0, phones: 1 });
    const r = fake.db.child_phone_bindings[0];
    expect(r).toMatchObject({ phone_norm: null, phone_tomb: tomb, revoked_at: now.toISOString(), revoked_by: 'expiry' });
    expect(JSON.stringify(r)).not.toContain(PHONE);
    expect(await BindRepo.activeForPhone(PHONE, now)).toEqual([]);
  });

  test('a row expiring at 18:59:59Z on 31 March is still active at 18:59:58Z, erased after', async () => {
    seed({ bindings: [row(KIDS[0], PHONE)] });
    const before = await Expiry().expireBindings(new Date('2027-03-31T18:59:58.000Z'));
    expect(before).toEqual({ expired: 0, deleted: 0, phones: 0 });
    expect(fake.db.child_phone_bindings[0]).toMatchObject({ phone_norm: PHONE, revoked_at: null });
    expect(await BindRepo.activeForPhone(PHONE, new Date('2027-03-31T18:59:58.000Z'))).toHaveLength(1);
    const after = await Expiry().expireBindings(new Date('2027-03-31T19:00:00.000Z'));
    expect(after.expired).toBe(1);
    expect(fake.db.child_phone_bindings[0].phone_norm).toBeNull();
  });

  test('the 13-month delete: erased rows older than 13 months go; younger erased rows and active rows stay', async () => {
    const now = new Date('2027-06-15T00:00:00.000Z');
    seed({ bindings: [
      row(KIDS[0], null, { id: 'old', revoked_at: '2026-05-14T23:59:59.000Z', revoked_by: 'stop' }),     // 13 months + 1 s
      row(KIDS[1], null, { id: 'young', revoked_at: '2026-05-15T00:00:01.000Z', revoked_by: 'page_undo' }), // just under 13 months
      row(KIDS[2], PHONE, { id: 'live', expires_at: '2028-03-31T18:59:59.000Z' }),
    ] });
    const out = await Expiry().expireBindings(now);
    expect(out).toEqual({ expired: 0, deleted: 1, phones: 0 });
    expect(fake.db.child_phone_bindings.map((r) => r.id).sort()).toEqual(['live', 'young']);
    expect(events('web_quiz.bind_rows_deleted')).toEqual([{ n: 1, w: 's' }]);
    expect(events('web_quiz.bind_expired')).toEqual([{ n: 0, w: 's' }]);
  });

  test('a deleted row a re-bind points at: the pointer is cleared first (rebind_of has no ON DELETE)', async () => {
    const now = new Date('2027-06-15T00:00:00.000Z');
    seed({ bindings: [
      row(KIDS[0], null, { id: 'old', revoked_at: '2026-01-01T00:00:00.000Z', revoked_by: 'stop' }),
      row(KIDS[0], PHONE, { id: 'new', rebind_of: 'old', expires_at: '2028-03-31T18:59:59.000Z' }),
    ] });
    expect((await Expiry().expireBindings(now)).deleted).toBe(1);
    expect(fake.db.child_phone_bindings).toEqual([expect.objectContaining({ id: 'new', rebind_of: null, phone_norm: PHONE })]);
    const order = writes().map((c) => c.op);
    expect(order.indexOf('update')).toBeLessThan(order.indexOf('delete'));
  });

  test('the cache forget count = distinct phones; each phone\'s door verdict is dropped; one event of each per run', async () => {
    seed({ bindings: [
      row(KIDS[0], PHONE, { expires_at: '2026-03-31T18:59:59.000Z' }),
      row(KIDS[1], PHONE, { expires_at: '2026-03-31T18:59:59.000Z' }),
      row(KIDS[2], PHONE_2, { expires_at: '2026-03-31T18:59:59.000Z' }),
    ] });
    [PHONE, PHONE_2].forEach((p) => redisService.__keys.set(Ingress.CACHE_KEY(p), { mode: 'student' }));
    const out = await require('../../../shared/services/quiz/web-quiz-bind-expiry').expireBindings(new Date('2026-04-01T00:00:00.000Z'));
    expect(out).toEqual({ expired: 3, deleted: 0, phones: 2 });
    expect(redisService.__keys.has(Ingress.CACHE_KEY(PHONE))).toBe(false);
    expect(redisService.__keys.has(Ingress.CACHE_KEY(PHONE_2))).toBe(false);
    expect(events('student_ingress.cache_forget')).toEqual([{ why: 'expire', n: 2, w: 's' }]);
    expect(events('web_quiz.bind_expired')).toEqual([{ n: 3, w: 's' }]);
    expect(events('web_quiz.bind_rows_deleted')).toEqual([{ n: 0, w: 's' }]);
    // ids and counts only: no phone on any event
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(PHONE.slice(-6));
  });

  test('never throws: a failing store → zeros and a log line', async () => {
    supabase.from = () => { throw new Error('db down'); };
    await expect(require('../../../shared/services/quiz/web-quiz-bind-expiry').expireBindings(new Date())).resolves.toEqual({ expired: 0, deleted: 0, phones: 0 });
    expect(logToFile).toHaveBeenCalled();
  });
});

describe('renewOnPlay({canonicalId, phoneNorm, playedAt})', () => {
  const Expiry = () => require('../../../shared/services/quiz/web-quiz-bind-expiry');

  test('renews the active binding of that pair to the 31 March of the play\'s year; last_played_at kept', async () => {
    seed({ bindings: [row(KIDS[0], PHONE, { expires_at: '2026-03-31T18:59:59.000Z' }), row(KIDS[1], PHONE)] });
    const playedAt = new Date('2025-10-15T10:00:00.000Z');
    const r = await Expiry().renewOnPlay({ canonicalId: KIDS[0], phoneNorm: PHONE, playedAt });
    expect(r).toMatchObject({ id: `b-01-${PHONE.slice(-3)}`, expires_at: '2026-03-31T18:59:59.000Z', last_played_at: playedAt.toISOString() });
    expect(fake.db.child_phone_bindings[1].last_played_at).toBeNull();
  });

  test('a play in the last 31 days before 31 March → the 31 March a year later', async () => {
    seed({ bindings: [row(KIDS[0], PHONE)] });
    const r = await Expiry().renewOnPlay({ canonicalId: KIDS[0], phoneNorm: PHONE, playedAt: new Date('2027-03-20T10:00:00.000Z') });
    expect(r.expires_at).toBe('2028-03-31T18:59:59.000Z');
  });

  test('no active binding of that pair → null, nothing written; switch off → null, nothing read', async () => {
    seed({ bindings: [row(KIDS[0], PHONE_2)] });
    expect(await Expiry().renewOnPlay({ canonicalId: KIDS[0], phoneNorm: PHONE, playedAt: new Date('2026-10-15T00:00:00.000Z') })).toBeNull();
    expect(writes()).toEqual([]);
    seed({ settings: { web_quiz_hub: true }, bindings: [row(KIDS[0], PHONE)] });
    expect(await Expiry().renewOnPlay({ canonicalId: KIDS[0], phoneNorm: PHONE, playedAt: new Date('2026-10-15T00:00:00.000Z') })).toBeNull();
    expect(fake.calls.filter((c) => c.table === 'child_phone_bindings')).toEqual([]);
  });
});

// ─── guest home ──────────────────────────────────────────────────────────────

describe('guest home (web_quiz_guest_home on)', () => {
  test('an unknown phone → the guest verdict, cached for 60 s (not the 10-minute door TTL)', async () => {
    seed({ settings: GUEST_ON });
    const v = await Ingress.classify({ user: UNKNOWN_USER, phone: PHONE });
    expect(v).toEqual({ persona: 'student', mode: 'student', reason: 'guest_phone', language: null, studentClass: null });
    const setCall = redisService.set.mock.calls.find(([k]) => k === Ingress.CACHE_KEY(PHONE));
    expect(setCall[2]).toBe(60);
  });

  test('a teacher phone is never a guest', async () => {
    seed({ settings: GUEST_ON });
    expect(await Ingress.classify({ user: TEACHER_USER, phone: PHONE })).toEqual({ persona: null, mode: 'teacher', reason: 'identity', language: null, studentClass: null });
  });

  test('/quiz → ONE guest reply: a cta_url to /h/<guest token> carrying only the tombstone; ledger guest_reply; no bind_bound', async () => {
    seed({ settings: GUEST_ON });
    withStandInCopy();
    expect(await say('/quiz')).toBe(true);
    expect(sends()).toBe(1);
    const [to, args] = WhatsApp.sendCtaUrl.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(args).toMatchObject({ body: resolveUx('guestHome', { language: 'en' }), buttonText: resolveUx('guestHomeBtn', { language: 'en' }) });
    expect(args.url.startsWith('https://portal.example.test/h/')).toBe(true);
    const token = args.url.split('/h/')[1];
    const payload = T.verify(token, 'g');
    expect(Object.keys(payload).sort()).toEqual(['exp', 'k', 't']);
    expect(payload).toMatchObject({ k: 'g', t: BindRepo.tombOf(PHONE) });
    expect(payload.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(3600);
    expect(Buffer.from(token.split('.')[0], 'base64url').toString()).not.toContain(PHONE.slice(-7));
    expect(T.verify(token, 'h')).toBeNull();
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ trigger: 'guest_reply', recipient: 'family', count: 1 })]);
    expect(events('web_quiz.bind_bound')).toEqual([]);
    // no loose child, no binding, no run row: the guest page that creates them is not built
    expect(writes().map((c) => c.table)).toEqual(['message_ledger']);
  });

  test('≤ 2 replies per guest: the third /quiz gets today\'s no-quizzes line, not a third guest reply', async () => {
    seed({ settings: GUEST_ON });
    withStandInCopy();
    await say('/quiz');
    redisService.__keys.delete(Ingress.CACHE_KEY(PHONE));
    await say('/quiz');
    redisService.__keys.delete(Ingress.CACHE_KEY(PHONE));
    await say('/quiz');
    expect(WhatsApp.sendCtaUrl).toHaveBeenCalledTimes(2);
    expect(WhatsApp.sendMessage.mock.calls).toEqual([[PHONE, resolveUx('sqNoQuizzes', { language: 'en' })]]);
    expect(fake.db.message_ledger[0].count).toBe(2);
  });

  test('copy gap: with the switch on and bot.guest.home missing, the placeholder throws and nothing untranslated is sent', async () => {
    seed({ settings: GUEST_ON });
    const GuestHome = require('../../../shared/services/quiz/web-quiz-guest-home');
    expect(() => GuestHome.copy('en')).toThrow(/bot\.guest\.home/);
    await say('/quiz');
    expect(WhatsApp.sendCtaUrl).not.toHaveBeenCalled();
    expect(WhatsApp.sendMessage.mock.calls).toEqual([[PHONE, resolveUx('sqNoQuizzes', { language: 'en' })]]);
    expect(fake.db.message_ledger).toEqual([]);
  });

  test('any other message from a guest phone takes today\'s unknown path (a new teacher still reaches registration)', async () => {
    seed({ settings: GUEST_ON });
    withStandInCopy();
    for (const body of ['hello', '/register', 'stop']) {
      const user = { ...UNKNOWN_USER };
      expect(await say(body, user)).toBe(false);
      expect(user).toMatchObject({ persona: null, personaReason: 'no_student_row' });
    }
    expect(sends()).toBe(0);
  });

  test('the hub answers 404 for a guest token (the guest page is not built)', async () => {
    seed({ settings: GUEST_ON });
    const token = T.signGuest({ phoneTomb: BindRepo.tombOf(PHONE) });
    await expect(require('../../../shared/services/quiz/web-quiz-hub').hub(token, {})).rejects.toMatchObject({ status: 404 });
  });

  test('signGuest: only a 32-hex tombstone is signed; never a phone; signHub cannot make one', () => {
    expect(T.signGuest({ phoneTomb: PHONE })).toBeNull();
    expect(T.signGuest({})).toBeNull();
    expect(T.signHub([])).toBeNull();
    expect(T.verify(T.signGuest({ phoneTomb: 'a'.repeat(32) }), 'g')).toMatchObject({ k: 'g', t: 'a'.repeat(32) });
  });
});

// ─── goldens ─────────────────────────────────────────────────────────────────

describe('goldens: guest home off → the original path (snapshots taken from the code before this change)', () => {
  test('unknown phone, every switch off → no_student_row deep-equal; /quiz not taken; nothing sent', async () => {
    seed({ settings: { web_quiz_hub: true } });
    const v = await Ingress.classify({ user: UNKNOWN_USER, phone: PHONE });
    expect(v).toMatchSnapshot();
    expect(redisService.set.mock.calls).toMatchSnapshot();
    expect(events('student_ingress.decided')).toMatchSnapshot();
    redisService.__keys.clear();
    expect(await say('/quiz')).toBe(false);
    expect(sends()).toBe(0);
  });

  test('phone bind on, guest home off → the same no_student_row verdict and the same /quiz path', async () => {
    seed({ settings: BIND_ON });
    const v = await Ingress.classify({ user: UNKNOWN_USER, phone: PHONE });
    expect(v).toMatchSnapshot();
    expect(redisService.set.mock.calls).toMatchSnapshot();
    redisService.__keys.clear();
    const user = { ...UNKNOWN_USER };
    expect(await say('/quiz', user)).toBe(false);
    expect(user).toMatchObject({ persona: null, personaReason: 'no_student_row' });
    expect(sends()).toBe(0);
  });

  test('a chat child with nothing to show, guest home off → today\'s no-quizzes line from open()', async () => {
    seed({ settings: BIND_ON });
    await StudentQuiz.open(PHONE, { language: 'en' });
    expect(WhatsApp.sendMessage.mock.calls).toMatchSnapshot();
    expect(WhatsApp.sendCtaUrl).not.toHaveBeenCalled();
  });
});
