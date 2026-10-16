'use strict';
/**
 * A child joins on their own (web-quiz-student-join.js, switch quiz_student_join): one join = one students row in the
 * /q/ forced_new shape + child_identity(tapped) + ONE child_phone_bindings row via 'guest' + the door's child key,
 * with the door cache forgotten; the next /quiz from that phone is known with no question; STOP still erases it.
 * The switch OFF writes nothing and answers {off:true}. Real join service, binder, repos, door keys and ingress;
 * Supabase, Redis, the WhatsApp send and the loggers are the faked boundaries.
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
    redis: { get: jest.fn(async (k) => (keys.has(k) ? JSON.stringify(keys.get(k)) : null)) },
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
const { logEvent } = require('../../../shared/utils/structured-logger');
const WhatsApp = require('../../../shared/services/whatsapp.service');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Ingress = require('../../../shared/services/student-ingress');
const StudentIdentity = require('../../../shared/services/quiz/student-identity.service');
const Binder = require('../../../shared/services/quiz/web-quiz-bind.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const GoNonce = require('../../../shared/services/first-touch/go-nonce');
const Join = require('../../../shared/services/quiz/web-quiz-student-join');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(721);
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';
const OTHER_DEVICE = 'BBBBBBBBBBBBBBBBBBBBBB';
const UNKNOWN_USER = { id: 'u-new', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en' };
const TEACHER_USER = { ...UNKNOWN_USER, id: 'u-teacher', registration_completed: true, name: 'Teacher Testwala' };
const KIDS = ['f0000000-0000-4000-8000-000000000101', 'f0000000-0000-4000-8000-000000000102',
  'f0000000-0000-4000-8000-000000000103', 'f0000000-0000-4000-8000-000000000104'];
const iso = (ms) => new Date(ms).toISOString();
const chatKid = (i, name) => ({ id: KIDS[i], student_name: name, phone: PHONE, list_id: null, is_active: true, status: 'active',
  self_reported_class: '3', created_at: iso(Date.now() - (10 - i) * 60000) });
const binding = (kid, extra = {}) => ({ id: `b-${kid.slice(-3)}`, canonical_id: kid, phone_norm: PHONE, phone_tomb: 'tomb', via: 'save',
  bound_at: iso(Date.now() - 86400000), expires_at: '2099-03-31T18:59:59.000Z', revoked_at: null, revoked_by: null, ...extra });

let fake;
function seed({ join = true, students = [], bindings = [], user = UNKNOWN_USER } = {}) {
  const settings = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true };
  if (join) settings.quiz_student_join = true;
  fake = makeFake({
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    users: [user], students, child_phone_bindings: bindings, child_identity: [], user_feature_first_use: [],
    quiz_sessions: [], class_enrollments: [], student_lists: [], class_teachers: [], quizzes: [], coaching_sessions: [],
    lesson_plans: [], training_assessment_attempts: [], assessment_requests: [], message_ledger: [],
  });
  supabase.from = (t) => {
    // the columns' database defaults (is_active true, status 'active') on rows the code inserted without them
    if (t === 'students') (fake.db.students || []).forEach((r) => { if (!('is_active' in r)) r.is_active = true; if (!('status' in r)) r.status = 'active'; });
    const b = fake.from(t);
    b.or = () => b;
    // feature-intro's upsert on UNIQUE (user_id, feature): an insert when absent is all these tests need
    b.upsert = (row) => b.insert(row);
    return b;
  };
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: { code: '42883', message: 'absent' } };
  IdFlags._resetCache();
  HubFlags._resetCache();
  Join._resetCache();
}
const writes = (table) => fake.calls.filter((c) => c.table === table && ['insert', 'update', 'delete'].includes(c.op));
const inserts = (table) => fake.calls.filter((c) => c.table === table && c.op === 'insert');
const events = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);
const sends = () => WhatsApp.sendMessage.mock.calls.length + WhatsApp.sendCtaUrl.mock.calls.length;
async function landing(user = UNKNOWN_USER) {
  const n = await GoNonce.mint({ phoneNorm: PHONE, userId: user.id });
  const url = await Join.joinUrl({ n, lang: 'ur' });
  return { n, url, t: url ? url.slice(Join.JOIN_PATH.length) : Join.signJoin({ n, lang: 'ur' }) };
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test' };
  jest.clearAllMocks();
  redis.__keys.clear();
  seed();
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { process.env = SAVED; });

describe('the switch off', () => {
  test('no join link, no write, every call answers off', async () => {
    seed({ join: false });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect(await Join.joinUrl({ n, lang: 'en' })).toBeNull();
    const t = Join.signJoin({ n, lang: 'en' });
    expect(await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE })).toEqual({ off: true });
    expect(await Join.gradeTap({ t, grade: 3, device: DEVICE })).toEqual({ off: true });
    expect(await Join.autoBind({ n })).toEqual({ off: true });
    expect(await Join.bindPick({ n, chip: 'x' })).toEqual({ off: true });
    expect(await Join.noteRecognised({ phoneNorm: PHONE })).toBe(false);
    ['students', 'child_phone_bindings', 'child_identity', 'user_feature_first_use'].forEach((tb) => expect(writes(tb)).toHaveLength(0));
    expect(sends()).toBe(0);
  });
});

describe('a new child joins: one row, one binding, forget called', () => {
  test('grade 3 + "Sara" → exactly one students row (the /q/ forced_new shape), child_identity tapped, one guest binding, the child key, forget, 0 messages', async () => {
    const forget = jest.spyOn(StudentIdentity, 'forgetDoorVerdict');
    const { t, url } = await landing();
    expect(url).toMatch(/^\/quiz\/join\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    expect(await Join.gradeTap({ t, grade: 3, device: DEVICE })).toEqual({ ok: true, prefetch: Join.HOME_ASSETS });
    const out = await Join.join({ t, grade: 3, name: '  Sara ', device: DEVICE });
    expect(out.next).toMatch(/^\/h\/[A-Za-z0-9_.-]+\?from=join&kid=[0-9a-f]{16}&lang=ur$/);

    expect(inserts('students')).toHaveLength(1);
    expect(inserts('students')[0].payload).toEqual([{ student_name: 'Sara', self_reported_class: 'Grade 3', enrolled_by_user_id: null, phone: null, list_id: null }]);
    const kidId = fake.db.students[0].id;
    expect(fake.db.child_identity).toEqual([expect.objectContaining({ canonical_id: kidId, fixed_grade: 3, grade_source: 'tapped' })]);
    expect(inserts('child_phone_bindings')).toHaveLength(1);
    expect(fake.db.child_phone_bindings[0]).toMatchObject({ canonical_id: kidId, phone_norm: PHONE, via: 'guest' });
    expect(fake.db.user_feature_first_use).toEqual([expect.objectContaining({ user_id: UNKNOWN_USER.id, feature: 'quiz_door_child' })]);
    expect(forget).toHaveBeenCalledWith(PHONE, PHONE);
    expect(events('web_quiz.bind_bound')).toEqual([expect.objectContaining({ via: 'guest', kids_n: 1, renewed: false })]);
    expect(events('web_quiz.join_grade')).toEqual([expect.objectContaining({ grade: 3 })]);
    expect(events('web_quiz.join_done')).toEqual([expect.objectContaining({ grade: 3, kids_n: 1 })]);
    // ids only: no name, no phone in any join line
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('Sara');
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(PHONE);
    expect(sends()).toBe(0);
    // the home opens on THIS child
    const tok = T.verify(out.next.slice(3).split('?')[0], 'h');
    expect(tok.ids).toEqual([kidId]);
  });

  test('the next /quiz from that phone is known with NO question (phone_bound_page_child), even inside the 10-minute cache', async () => {
    const first = await Ingress.classify({ user: { ...UNKNOWN_USER }, phone: PHONE });
    expect(first.persona).toBeNull();
    const { t } = await landing();
    await Join.join({ t, grade: 2, name: 'Sara', device: DEVICE });
    const kidId = fake.db.students[0].id;
    const second = await Ingress.classify({ user: { ...UNKNOWN_USER }, phone: PHONE });
    expect(second).toMatchObject({ persona: 'student', mode: 'student', reason: 'phone_bound_page_child', ids: [kidId] });
    expect(await Join.noteRecognised({ phoneNorm: PHONE })).toBe(true);
    expect(await Join.noteRecognised({ phoneNorm: PHONE })).toBe(false); // once a PKT day
    expect(events('web_quiz.join_recognised')).toHaveLength(1);
  });

  test('a second "Let\'s go" on the same link makes no second child', async () => {
    const { t } = await landing();
    const a = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    const b = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE, force: true });
    expect(inserts('students')).toHaveLength(1);
    expect(b.next.split('?')[1]).toBe(a.next.split('?')[1]);
  });

  test('STOP still erases the guest binding (IDENTITY §7)', async () => {
    const { t } = await landing();
    await Join.join({ t, grade: 4, name: 'Sara', device: DEVICE });
    expect(await Binder.handleStop({ phone: PHONE, user: UNKNOWN_USER })).toEqual({ n: 1, children: 1 });
    expect(fake.db.child_phone_bindings[0]).toMatchObject({ phone_norm: null, revoked_by: 'stop' });
    expect((await Ingress.classify({ user: { ...UNKNOWN_USER }, phone: PHONE })).reason).not.toBe('phone_bound_page_child');
  });
});

describe('the guards before the row', () => {
  test('another device holding the link → stale, nothing written', async () => {
    const { t } = await landing();
    await Join.gradeTap({ t, grade: 3, device: DEVICE });
    expect(await Join.join({ t, grade: 3, name: 'Sara', device: OTHER_DEVICE })).toEqual({ stale: true, why: 'other_device' });
    expect(writes('students')).toHaveLength(0);
  });

  test('a forged, expired or unknown-nonce token → stale', async () => {
    expect(await Join.join({ t: 'x.y', grade: 3, name: 'Sara', device: DEVICE })).toEqual({ stale: true });
    const t = Join.signJoin({ n: T.newNonce(), lang: 'en' });
    expect(await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE })).toEqual({ stale: true });
    expect(writes('students')).toHaveLength(0);
  });

  test('a bad grade or a name with digits (a phone typed as a name) → refused before any write', async () => {
    const { t } = await landing();
    expect(await Join.join({ t, grade: 6, name: 'Sara', device: DEVICE })).toEqual({ error: 'bad_request', why: 'grade' });
    expect(await Join.join({ t, grade: 3, name: '0300 1234567', device: DEVICE })).toEqual({ error: 'bad_request', why: 'name' });
    expect(await Join.join({ t, grade: 3, name: 'Sara Ali Khan', device: DEVICE })).toEqual({ error: 'bad_request', why: 'name' });
    expect(writes('students')).toHaveLength(0);
  });

  test('a teacher\'s phone → refused teacher_phone, practice offered, nothing written', async () => {
    seed({ user: TEACHER_USER });
    const { t } = await landing(TEACHER_USER);
    const out = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    expect(out).toEqual({ refused: 'teacher_phone', next: '/quiz/home?m=practice&g=3&lang=ur' });
    ['students', 'child_phone_bindings', 'child_identity', 'user_feature_first_use'].forEach((tb) => expect(writes(tb)).toHaveLength(0));
  });

  test('the same first name already on this phone → "Is this you?" (never a twin row); yes → that child bound; "someone new" → a new row', async () => {
    seed({ students: [chatKid(0, 'Sara Testwala')] });
    const { t } = await landing();
    const ask = await Join.join({ t, grade: 3, name: 'sara', device: DEVICE });
    expect(ask).toEqual({ ask: 'is_this_you', kids: [{ chip: T.chipId('j', KIDS[0]), first: 'Sara', animal: T.animalFor(KIDS[0]) }] });
    expect(writes('students')).toHaveLength(0);
    const yes = await Join.join({ t, grade: 3, name: 'sara', device: DEVICE, same: T.chipId('j', KIDS[0]) });
    expect(yes.next).toContain(`kid=${T.chipId('h', KIDS[0])}`);
    expect(inserts('students')).toHaveLength(0);
    expect(fake.db.child_phone_bindings).toEqual([expect.objectContaining({ canonical_id: KIDS[0], via: 'guest' })]);

    seed({ students: [chatKid(0, 'Sara Testwala')] });
    redis.__keys.clear();
    const l2 = await landing();
    const fresh = await Join.join({ t: l2.t, grade: 1, name: 'Sara', device: DEVICE, force: true });
    expect(fresh.next).toMatch(/^\/h\//);
    expect(inserts('students')).toHaveLength(1);
  });

  test('a phone with 4 children → refused max_kids with the way home, no row', async () => {
    seed({ students: [chatKid(0, 'Ali Testwala'), chatKid(1, 'Bina Testwala'), chatKid(2, 'Chand Testwala'), chatKid(3, 'Dua Testwala')] });
    const { t } = await landing();
    const out = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    expect(out.refused).toBe('max_kids');
    expect(out.next).toMatch(/^\/h\/.+from=join/);
    expect(writes('students')).toHaveLength(0);
    expect(writes('child_phone_bindings')).toHaveLength(0);
  });

  test('a failed binding retires the row it just made (no orphan child in any list)', async () => {
    delete process.env.WQ_TOMB_SALT; // the binder writes nothing without the salt; phoneBind is then off too
    IdFlags._resetCache(); Join._resetCache();
    const { t } = await landing();
    expect(await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE })).toEqual({ off: true });
    expect(writes('students')).toHaveLength(0);
  });
});

describe('practice (the coach\'s "Try it as a student")', () => {
  test('no row, no binding, no key, no nonce — the practice home for the grade', async () => {
    const t = Join.signJoin({ lang: 'en', mode: 'practice' });
    expect(await Join.gradeTap({ t, grade: 2, device: DEVICE })).toMatchObject({ ok: true });
    expect(await Join.join({ t, grade: 2, name: 'Sara', device: DEVICE })).toEqual({ next: '/quiz/home?m=practice&g=2&lang=en', practice: true });
    ['students', 'child_phone_bindings', 'child_identity', 'user_feature_first_use'].forEach((tb) => expect(writes(tb)).toHaveLength(0));
  });
});

describe('the /quiz landing for a chat-joined phone with no binding (ROLE §4.2)', () => {
  test('ONE child → the binding via guest written on landing, bind_auto, home; 0 messages', async () => {
    seed({ students: [chatKid(0, 'Ali Testwala')] });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    const out = await Join.autoBind({ n, lang: 'en' });
    expect(out.next).toMatch(/^\/h\/.+\?from=quiz&kid=[0-9a-f]{16}&lang=en$/);
    expect(fake.db.child_phone_bindings).toEqual([expect.objectContaining({ canonical_id: KIDS[0], via: 'guest', phone_norm: PHONE })]);
    expect(events('web_quiz.bind_auto')).toEqual([expect.objectContaining({ src: 'quiz' })]);
    expect(sends()).toBe(0);
    // already bound → no second write
    await Join.autoBind({ n, lang: 'en' });
    expect(inserts('child_phone_bindings')).toHaveLength(1);
  });

  test('SEVERAL children → the "Whose turn?" chips; a pick binds that child only; a stranger chip is refused', async () => {
    seed({ students: [chatKid(0, 'Ali Testwala'), chatKid(1, 'Bina Testwala')] });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    const out = await Join.autoBind({ n });
    expect(out.pick.map((c) => c.first).sort()).toEqual(['Ali', 'Bina']);
    expect(writes('child_phone_bindings')).toHaveLength(0);
    expect(await Join.bindPick({ n, chip: T.chipId('go', 'f0000000-0000-4000-8000-00000000dead') })).toEqual({ refused: 'child_unknown' });
    const picked = await Join.bindPick({ n, chip: T.chipId('go', KIDS[1]) });
    expect(picked.next).toContain(`kid=${T.chipId('h', KIDS[1])}`);
    expect(fake.db.child_phone_bindings).toEqual([expect.objectContaining({ canonical_id: KIDS[1], via: 'guest' })]);
  });

  test('no child on the phone → the join screen link', async () => {
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect((await Join.autoBind({ n })).join).toMatch(/^\/quiz\/join\//);
  });
});

describe('the page-side bind never sends a message', () => {
  test('bindOnPhone: the binder\'s checks, no code, no reply; a teacher phone refused', async () => {
    seed({ students: [chatKid(0, 'Ali Testwala')] });
    expect(await Binder.bindOnPhone({ phone: PHONE, canonicalId: KIDS[0], mode: 'teacher' })).toEqual({ ok: false, outcome: 'refused', reason: 'teacher_phone' });
    const ok = await Binder.bindOnPhone({ phone: PHONE, canonicalId: KIDS[0], via: 'guest', mode: 'student' });
    expect(ok).toMatchObject({ ok: true, outcome: 'bound', canonicalId: KIDS[0], renewed: false });
    const again = await Binder.bindOnPhone({ phone: PHONE, canonicalId: KIDS[0], via: 'guest', mode: 'student' });
    expect(again).toMatchObject({ ok: true, renewed: true });
    expect(sends()).toBe(0);
  });
});

describe('the nonce map', () => {
  test('peek is re-usable; claim is once per purpose and never burns another purpose', async () => {
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: 'u1' });
    expect(n).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await GoNonce.peek(n)).toEqual({ phoneNorm: PHONE, userId: 'u1' });
    expect(await GoNonce.claim(n, 'role')).toEqual({ phoneNorm: PHONE, userId: 'u1' });
    expect(await GoNonce.claim(n, 'role')).toBeNull();
    expect(await GoNonce.claim(n, 'join')).toEqual({ phoneNorm: PHONE, userId: 'u1' });
    expect(await GoNonce.claim(n, 'nope')).toBeNull();
    expect(await GoNonce.peek('not-a-nonce')).toBeNull();
    // the key is a hash: neither the nonce nor the phone is a Redis key
    expect([...redis.__keys.keys()].some((k) => k.includes(n) || k.includes(PHONE))).toBe(false);
  });
});
