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
function seed({ join = true, joinValue = true, students = [], bindings = [], user = UNKNOWN_USER, lists = [], early, adv, oneButton } = {}) {
  const settings = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true };
  if (join) settings.quiz_student_join = joinValue;
  if (early !== undefined) settings.quiz_join_early_tap = early;
  if (adv !== undefined) settings.web_quiz_adventure_look = adv;
  if (oneButton !== undefined) settings.web_quiz_one_button = oneButton;
  fake = makeFake({
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    users: [user], students, child_phone_bindings: bindings, child_identity: [], user_feature_first_use: [],
    quiz_sessions: [], class_enrollments: [], student_lists: lists, class_teachers: [], quizzes: [], coaching_sessions: [],
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

// A child whose place is saved on this phone with no code (a guest binding): ON hides the card; every OFF row leaves it.
async function hideOff() {
  const kid = 'e0000000-0000-4000-8000-0000000000aa';
  fake.db.students.push({ id: kid, list_id: null, student_name: 'Dua Testwala', status: 'active', is_active: true, merged_into: null });
  fake.db.child_phone_bindings.push({ id: 'g-aa', canonical_id: kid, phone_norm: PHONE, phone_tomb: 't', via: 'guest', revoked_at: null, expires_at: '2099-03-31T18:59:59.000Z', bound_at: '2026-10-16T10:00:00Z' });
  return Join.hideCardIfBound({ bind: { offer: true } }, kid);
}

describe('the switch off', () => {
  test.each([
    ['absent', { join: false }], ['"yes"', { joinValue: 'yes' }], ['1', { joinValue: 1 }], ['{}', { joinValue: {} }], ['false', { joinValue: false }],
  ])('switch row %s → no join link, no write, every call answers off', async (_label, opts) => {
    seed(opts);
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    await Join.flags();
    expect(Join.joinUrl({ n, lang: 'en' })).toBeNull();
    const t = Join.signJoin({ n, lang: 'en' });
    expect(await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE })).toEqual({ off: true });
    expect(await Join.gradeTap({ t, grade: 3, device: DEVICE })).toEqual({ off: true });
    expect(await Join.autoBind({ n })).toEqual({ off: true });
    expect(await Join.bindPick({ n, chip: 'x' })).toEqual({ off: true });
    expect(await Join.noteRecognised({ phoneNorm: PHONE })).toBe(false);
    expect(await Join.siblingJoinToken({ phoneNorm: PHONE, userId: UNKNOWN_USER.id, lang: 'en' })).toBeNull();
    expect(await hideOff()).toEqual({ bind: { offer: true } });
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
    // no join token rides the home URL ("Someone new?" mints its own at render: siblingJoinToken)
    expect(out.next).not.toMatch(/[?&]jn=/);

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
    const kidOf = (u) => new URLSearchParams(u.split('?')[1]).get('kid');
    expect(kidOf(b.next)).toBe(kidOf(a.next));
  });

  test('STOP still erases the guest binding (IDENTITY §7)', async () => {
    const { t } = await landing();
    await Join.join({ t, grade: 4, name: 'Sara', device: DEVICE });
    expect(await Binder.handleStop({ phone: PHONE, user: UNKNOWN_USER })).toEqual({ n: 1, children: 1 });
    expect(fake.db.child_phone_bindings[0]).toMatchObject({ phone_norm: null, revoked_by: 'stop' });
    expect((await Ingress.classify({ user: { ...UNKNOWN_USER }, phone: PHONE })).reason).not.toBe('phone_bound_page_child');
  });
});

describe('the home after a join never shows the claim card', () => {
  const homeOf = async (next) => {
    const Hub = require('../../../shared/services/quiz/web-quiz-hub');
    const [p, q] = next.split('?');
    const token = p.slice(3);
    const kid = new URLSearchParams(q).get('kid');
    return Hub.hub(token, { device: DEVICE, kid, src: 'join' });
  };
  test('ON: the joined child\'s home → bind {offer:false, state:"bound"}, on this link and on a fresh one', async () => {
    const { t } = await landing();
    const out = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    const home = await homeOf(out.next);
    expect(home.bind).toEqual({ offer: false, state: 'bound' });
    const kidId = fake.db.students[0].id;
    const fresh = `/h/${T.signHub([kidId], 'test')}?kid=${T.chipId('h', kidId)}`;
    redis.__keys.clear();
    expect((await homeOf(fresh)).bind).toEqual({ offer: false, state: 'bound' });
  });
  test('OFF after the join: today\'s card, untouched', async () => {
    const { t } = await landing();
    const out = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    fake.db.app_settings = fake.db.app_settings.filter((r) => r.key !== 'quiz_student_join');
    Join._resetCache();
    const home = await homeOf(out.next);
    expect(home.bind).toMatchObject({ offer: true });
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
    expect(out.refused).toBe('teacher_phone');
    expect(T.verify(out.next.slice(3).split('?')[0], 'h')).toEqual(expect.objectContaining({ ids: [], pr: 1, g: 3, lang: 'ur', tu: TEACHER_USER.id }));
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

  test('a fresh phone typing a classmate\'s name sees no name: no "Are you…?", a new child of its own', async () => {
    const OTHER = fixturePhone(722);
    seed({ students: [{ ...chatKid(0, 'Sara Testwala'), phone: OTHER },
      { id: KIDS[1], student_name: 'Sara Testwala', phone: null, parent_phone: `+${OTHER}`, list_id: 'list-1', school_id: 'sch-1', is_active: true, status: 'active', merged_into: null }],
    lists: [{ id: 'list-1', user_id: 'u-t1', is_active: true, created_at: iso(Date.now() - 86400000) }] });
    const { t } = await landing();
    const out = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    expect(out.ask).toBeUndefined();
    expect(out.next).toMatch(/^\/h\//);
    expect(JSON.stringify(out)).not.toContain('Testwala');
    expect(inserts('students')).toHaveLength(1);
  });

  test('a phone with 4 children → refused max_kids with the way home, no row', async () => {
    seed({ students: [chatKid(0, 'Ali Testwala'), chatKid(1, 'Bina Testwala'), chatKid(2, 'Chand Testwala'), chatKid(3, 'Dua Testwala')] });
    const { t } = await landing();
    const out = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    expect(out.refused).toBe('max_kids');
    expect(out.next).toMatch(/^\/h\/.+from=join/);
    // the way home names the phone's FOUR children — never the string "null" (a uuid column refuses it: an empty home)
    const ids = T.verify(out.next.slice(3).split('?')[0], 'h').ids;
    expect([...ids].sort()).toEqual([...KIDS].sort());
    expect(new URLSearchParams(out.next.split('?')[1]).get('kid')).toBeNull();
    expect(writes('students')).toHaveLength(0);
    expect(writes('child_phone_bindings')).toHaveLength(0);
  });

  test('no tomb salt → the binder cannot bind, so the join answers off and writes nothing', async () => {
    delete process.env.WQ_TOMB_SALT;
    IdFlags._resetCache(); Join._resetCache();
    const { t } = await landing();
    expect(await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE })).toEqual({ off: true });
    expect(writes('students')).toHaveLength(0);
  });
});

describe('practice (the coach\'s "Try it as a student")', () => {
  test('the grade only, no name; no row, no binding, no key, no nonce — the practice home for the grade', async () => {
    const url = await Join.practiceJoinUrl({ lang: 'en' });
    expect(url).toMatch(/^\/quiz\/join\//);
    const t = url.slice(Join.JOIN_PATH.length);
    expect(T.verify(t, 'j')).toEqual(expect.objectContaining({ k: 'j', m: 'practice', l: 'en' }));
    expect(T.verify(t, 'j').n).toBeUndefined();
    expect(await Join.pageInfo({ t })).toEqual({ ok: true, lang: 'en', practice: true });
    expect(await Join.gradeTap({ t, grade: 2, device: DEVICE })).toMatchObject({ ok: true });
    const out = await Join.join({ t, grade: 2, device: DEVICE });
    expect(out.practice).toBe(true);
    expect(out.next).toMatch(/^\/h\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}\?from=join$/);
    // the practice home's token: no child, the grade, the language — the home draws the class's view and writes nothing
    expect(T.verify(out.next.slice(3).split('?')[0], 'h')).toEqual(expect.objectContaining({ k: 'h', ids: [], pr: 1, g: 2, lang: 'en' }));
    ['students', 'child_phone_bindings', 'child_identity', 'user_feature_first_use'].forEach((tb) => expect(writes(tb)).toHaveLength(0));
  });
});

describe('practice: the way back to the teacher home', () => {
  test('a teacher-home path rides to the practice home as bk; anything else is dropped', async () => {
    await Join.flags();
    const back = '/quiz/teacher/abc.def_ghi';
    const t = Join.practiceJoinUrl({ lang: 'ur', back }).slice(Join.JOIN_PATH.length);
    const out = await Join.join({ t, grade: 4, device: DEVICE });
    expect(T.verify(out.next.slice(3).split('?')[0], 'h')).toEqual(expect.objectContaining({ pr: 1, g: 4, bk: back }));
    const t2 = Join.practiceJoinUrl({ lang: 'ur', back: 'https://evil.example/x' }).slice(Join.JOIN_PATH.length);
    const out2 = await Join.join({ t: t2, grade: 4, device: DEVICE });
    expect(T.verify(out2.next.slice(3).split('?')[0], 'h').bk).toBeUndefined();
  });
});

describe('"Someone new?" on the same phone', () => {
  test('the home after a join carries no join token; "Someone new?" mints one at render (siblingJoinToken) and a brother joins through it as a second child', async () => {
    const { t } = await landing();
    const a = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    expect(new URLSearchParams(a.next.split('?')[1]).get('jn')).toBeNull();
    const jn = await Join.siblingJoinToken({ phoneNorm: PHONE, userId: UNKNOWN_USER.id, lang: 'ur' });
    expect(T.verify(jn, 'j').n).not.toBe(T.verify(t, 'j').n);
    const b = await Join.join({ t: jn, grade: 1, name: 'Bilal', device: DEVICE });
    expect(b.next).toMatch(/^\/h\//);
    expect(inserts('students')).toHaveLength(2);
    expect(fake.db.child_phone_bindings.map((x) => x.via)).toEqual(['guest', 'guest']);
    // the home of the second child names both children of the phone
    expect(T.verify(b.next.slice(3).split('?')[0], 'h').ids).toHaveLength(2);
  });

  test('siblingJoinToken with the phone only (what the home holds): the phone\'s own user is found, the token joins a second child; an unknown phone → null', async () => {
    const { t } = await landing();
    await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    fake.db.users[0].phone_number = PHONE;
    expect(await Join.siblingJoinToken({ phoneNorm: fixturePhone(999), lang: 'ur' })).toBeNull();
    const jn = await Join.siblingJoinToken({ phoneNorm: PHONE, lang: 'ur' });
    expect(T.verify(jn, 'j')).toEqual(expect.objectContaining({ k: 'j', l: 'ur' }));
    const b = await Join.join({ t: jn, grade: 1, name: 'Bilal', device: DEVICE });
    expect(b.next).toMatch(/^\/h\//);
    expect(fake.db.child_phone_bindings.map((x) => x.via)).toEqual(['guest', 'guest']);
  });

  test('siblingJoinToken: off → null; on → a fresh token for that phone', async () => {
    expect(await Join.siblingJoinToken({ phoneNorm: PHONE, userId: UNKNOWN_USER.id, lang: 'ur' })).toMatch(/\./);
    seed({ join: false });
    expect(await Join.siblingJoinToken({ phoneNorm: PHONE, userId: UNKNOWN_USER.id, lang: 'ur' })).toBeNull();
  });
});

describe('the page shell answer', () => {
  test('the shell reads nothing but the cached switches before the first byte: only app_settings cold, then 0 reads', async () => {
    const { t } = await landing();
    const old = T.sign({ k: 'j', n: T.newNonce(), l: 'ur', exp: Math.floor(Date.now() / 1000) - 5 });
    const real = supabase.from;
    const tables = [];
    supabase.from = (tb) => { tables.push(tb); return real(tb); };
    try {
      Join._resetCache();
      for (const tok of [t, 'x.y', old]) await Join.pageInfo({ t: tok });
      // cold: the join switch and its parents (identity, hub), each through its own 30 s cache — no other table
      expect(tables.length).toBeGreaterThan(0);
      expect([...new Set(tables)]).toEqual(['app_settings']);
      tables.length = 0;
      for (const tok of [t, 'x.y', old]) await Join.pageInfo({ t: tok });
      expect(tables).toEqual([]);
    } finally { supabase.from = real; }
  });

  test('on: the language and mode; a forged token → stale; an expired one → stale with its language', async () => {
    const { t } = await landing();
    expect(await Join.pageInfo({ t })).toEqual({ ok: true, lang: 'ur', practice: false });
    expect(await Join.pageInfo({ t: 'x.y' })).toEqual({ stale: true, lang: null });
    const old = T.sign({ k: 'j', n: T.newNonce(), l: 'ur', exp: Math.floor(Date.now() / 1000) - 5 });
    expect(await Join.pageInfo({ t: old })).toEqual({ stale: true, lang: 'ur' });
  });

  test('quiz_join_early_tap: only JSON true adds earlyTap to the page answer; every other value, unset or a failed read: no field (today\'s answer)', async () => {
    const { t } = await landing();
    const ON = { ok: true, lang: 'ur', practice: false, earlyTap: true };
    const OFF = { ok: true, lang: 'ur', practice: false };
    for (const [early, want] of [[true, ON], ['true', OFF], ['"true"', OFF], [' TRUE ', OFF], ['yes', OFF], ['on', OFF], [1, OFF],
      [null, OFF], [{ enabled: true }, OFF], [false, OFF], [undefined, OFF]]) {
      seed({ early });
      Join._resetCache();
      expect([early, await Join.pageInfo({ t })]).toEqual([early, want]);
    }
    // a read of the early-tap key that throws: OFF, the join itself unaffected
    seed({ early: true });
    Join._resetCache();
    const real = supabase.from;
    supabase.from = (tb) => { const b = real(tb); const eq = b.eq; b.eq = (c, v) => { if (v === 'quiz_join_early_tap') throw new Error('boom'); return eq.call(b, c, v); }; return b; };
    try {
      expect(await Join.pageInfo({ t })).toEqual(OFF);
    } finally { supabase.from = real; }
    // the join switch off: still {off:true}, and the early-tap key is never read
    seed({ join: false, early: true });
    Join._resetCache();
    const keys = [];
    supabase.from = (tb) => { const b = real(tb); const eq = b.eq; b.eq = (c, v) => { keys.push(v); return eq.call(b, c, v); }; return b; };
    try {
      expect(await Join.pageInfo({ t })).toEqual({ off: true });
      expect(keys).not.toContain('quiz_join_early_tap');
    } finally { supabase.from = real; }
  });

  test('web_quiz_adventure_look AND web_quiz_one_button: only both JSON true add adv to the page answer (and the expired one); one read, as today', async () => {
    const { t } = await landing();
    const old = T.sign({ k: 'j', n: T.newNonce(), l: 'ur', exp: Math.floor(Date.now() / 1000) - 5 });
    const real = supabase.from;
    const counted = async () => {
      let reads = 0;
      const keys = [];
      supabase.from = (tb) => {
        const b = real(tb);
        if (tb === 'app_settings') { reads += 1; const inF = b.in; b.in = (c, vs) => { keys.push(...vs); return inF.call(b, c, vs); }; }
        return b;
      };
      try { Join._resetCache(); const page = await Join.pageInfo({ t }); const stale = await Join.pageInfo({ t: old }); return { page, stale, reads, keys }; } finally { supabase.from = real; }
    };
    seed();
    await counted();                                  // the first open of the test also warms other modules: not counted
    const rows = [[true, true, true],
      [true, undefined, false], [true, false, false], [true, 'true', false], [true, 1, false], [true, { on: true }, false],
      ['true', true, false], ['"true"', true, false], [1, true, false], ['yes', true, false], [null, true, false], [{ on: true }, true, false],
      [false, true, false], [undefined, true, false]];
    const seen = [];                                  // the keys each read asked for: checked after the answers
    for (const [adv, oneButton, want] of rows) {
      seed();
      const base = await counted();                   // the same open with both keys absent (today)
      expect(base.page).toEqual({ ok: true, lang: 'ur', practice: false });
      seed({ adv, oneButton });
      const got = await counted();
      const row = [adv, oneButton];
      expect([row, got.page]).toEqual([row, want ? { ok: true, lang: 'ur', practice: false, adv: true } : base.page]);
      expect([row, got.stale]).toEqual([row, want ? { stale: true, lang: 'ur', adv: true } : base.stale]);
      expect([row, got.reads]).toEqual([row, base.reads]);
      seen.push(got.keys);
    }
    for (const k of seen) expect(k).toEqual(expect.arrayContaining(['quiz_student_join', 'web_quiz_adventure_look', 'web_quiz_one_button']));
    // the join switch off: still {off:true}, nothing about the look
    seed({ join: false, adv: true, oneButton: true });
    Join._resetCache();
    expect(await Join.pageInfo({ t })).toEqual({ off: true });
  });

  test('the bot\'s WhatsApp number rides the answer, for the expired page\'s one tap back; none configured → no number', async () => {
    const BOT_NO = fixturePhone(100);
    process.env.WHATSAPP_BOT_NUMBER = `+${BOT_NO}`;
    const { t } = await landing();
    expect(await Join.pageInfo({ t })).toEqual({ ok: true, lang: 'ur', practice: false, bot: BOT_NO });
    expect(await Join.pageInfo({ t: 'x.y' })).toEqual({ stale: true, lang: null, bot: BOT_NO });
    delete process.env.WHATSAPP_BOT_NUMBER;
    delete process.env.REFERRAL_BOT_NUMBER;
    expect(await Join.pageInfo({ t: 'x.y' })).toEqual({ stale: true, lang: null });
    // 10 to 15 digits, the share card's own rule: a 9-digit value is no number
    process.env.WHATSAPP_BOT_NUMBER = ['1234', '56789'].join('');
    expect(await Join.pageInfo({ t: 'x.y' })).toEqual({ stale: true, lang: null });
    delete process.env.WHATSAPP_BOT_NUMBER;
  });

  test('the internal route: an expired link → 410 with its language and the bot\'s number', async () => {
    const express = require('express');
    const BOT_NO = fixturePhone(100);
    process.env.WHATSAPP_BOT_NUMBER = BOT_NO;
    process.env.INTERNAL_API_KEY = 'route-key';
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    try {
      const old = T.sign({ k: 'j', n: T.newNonce(), l: 'ur', exp: Math.floor(Date.now() / 1000) - 5 });
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/wq/join/page/${old}`, { headers: { 'x-api-key': 'route-key' } });
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: 'stale', lang: 'ur', bot: BOT_NO });
    } finally { await new Promise((r) => server.close(r)); }
  });

  test.each([
    ['absent', null], ['false', false], ['the string "yes"', 'yes'], ['the number 1', 1], ['an object', {}],
  ])('the switch row %s → off everywhere, nothing written', async (_label, value) => {
    seed({ join: false });
    if (value !== null) fake.db.app_settings.push({ key: 'quiz_student_join', value });
    Join._resetCache();
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    const t = Join.signJoin({ n, lang: 'en' });
    expect(await Join.pageInfo({ t })).toEqual({ off: true });
    expect(Join.joinUrl({ n, lang: 'en' })).toBeNull();
    expect(await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE })).toEqual({ off: true });
    expect(await Join.autoBind({ n })).toEqual({ off: true });
    expect(await Join.siblingJoinToken({ phoneNorm: PHONE, userId: UNKNOWN_USER.id, lang: 'en' })).toBeNull();
    expect(await hideOff()).toEqual({ bind: { offer: true } });
    ['students', 'child_phone_bindings', 'child_identity', 'user_feature_first_use'].forEach((tb) => expect(writes(tb)).toHaveLength(0));
  });

  test('the app_settings read THROWS → off, nothing written', async () => {
    const real = supabase.from;
    supabase.from = (tb) => { if (tb === 'app_settings') throw new Error('down'); return real(tb); };
    Join._resetCache();
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect(await Join.pageInfo({ t: Join.signJoin({ n, lang: 'en' }) })).toEqual({ off: true });
    expect(await Join.join({ t: Join.signJoin({ n, lang: 'en' }), grade: 3, name: 'Sara', device: DEVICE })).toEqual({ off: true });
    supabase.from = real;
    expect(writes('students')).toHaveLength(0);
  });
});

describe('the /quiz landing for a phone with children but no binding: never a silent bind', () => {
  test('ONE chat child → the confirm sheet (nothing written); "Yes, it\'s me" → ONE guest binding, bind_confirm, home from=bind; 0 messages', async () => {
    seed({ students: [chatKid(0, 'Ali Testwala')] });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    const out = await Join.autoBind({ n, lang: 'en' });
    expect(out).toEqual({ confirm: { src: 'quiz', kids: [{ chip: T.chipId('go', KIDS[0]), first: 'Ali', animal: T.animalFor(KIDS[0]) }] } });
    expect(writes('child_phone_bindings')).toHaveLength(0);
    const picked = await Join.bindPick({ n, chip: out.confirm.kids[0].chip, lang: 'en' });
    expect(picked.next).toMatch(/^\/h\/.+\?from=bind&kid=[0-9a-f]{16}&lang=en$/);
    expect(fake.db.child_phone_bindings).toEqual([expect.objectContaining({ canonical_id: KIDS[0], via: 'guest', phone_norm: PHONE })]);
    expect(events('web_quiz.bind_confirm')).toEqual([expect.objectContaining({ src: 'quiz' })]);
    expect(sends()).toBe(0);
    // bound now → the next landing goes home with no sheet and no toast (from=quiz), and writes nothing
    const again = await Join.autoBind({ n, lang: 'en' });
    expect(again.next).toMatch(/\?from=quiz&kid=/);
    expect(inserts('child_phone_bindings')).toHaveLength(1);
  });

  test('SEVERAL children → the same sheet with their chips; a stranger chip is refused; a pick binds that child only', async () => {
    seed({ students: [chatKid(0, 'Ali Testwala'), chatKid(1, 'Bina Testwala')] });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    const out = await Join.autoBind({ n });
    expect(out.confirm.kids.map((c) => c.first).sort()).toEqual(['Ali', 'Bina']);
    expect(await Join.bindPick({ n, chip: T.chipId('go', 'f0000000-0000-4000-8000-00000000dead') })).toEqual({ refused: 'child_unknown' });
    const picked = await Join.bindPick({ n, chip: T.chipId('go', KIDS[1]) });
    expect(picked.next).toContain(`kid=${T.chipId('h', KIDS[1])}`);
    expect(fake.db.child_phone_bindings).toEqual([expect.objectContaining({ canonical_id: KIDS[1], via: 'guest' })]);
    // the already-saved child picked again: home with no second write and no "saved" line
    const again = await Join.bindPick({ n, chip: T.chipId('go', KIDS[1]) });
    expect(again.next).toMatch(/from=quiz/);
    expect(inserts('child_phone_bindings')).toHaveLength(1);
  });

  test('a phone whose TWO children are both saved → home with both ids, no "null", no kid, no sheet', async () => {
    seed({ students: [chatKid(0, 'Ali Testwala'), chatKid(1, 'Bina Testwala')], bindings: [binding(KIDS[0]), binding(KIDS[1])] });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    const out = await Join.autoBind({ n, lang: 'ur' });
    expect(out.next).toMatch(/^\/h\/.+\?from=quiz&lang=ur$/);
    expect([...T.verify(out.next.slice(3).split('?')[0], 'h').ids].sort()).toEqual([KIDS[0], KIDS[1]]);
  });

  test('no language given (the landing passes none) → the home URL carries no lang, so the home keeps the family\'s own', async () => {
    seed({ students: [chatKid(0, 'Ali Testwala')], bindings: [] });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    const sheet = await Join.autoBind({ n });
    const picked = await Join.bindPick({ n, chip: sheet.confirm.kids[0].chip });
    expect(picked.next).toMatch(/^\/h\/.+\?from=bind&kid=[0-9a-f]{16}$/);
    expect(new URLSearchParams(picked.next.split('?')[1]).get('lang')).toBeNull();
    const again = await Join.autoBind({ n });
    expect(new URLSearchParams(again.next.split('?')[1]).get('lang')).toBeNull();
    const ur = await Join.bindPick({ n, chip: sheet.confirm.kids[0].chip, lang: 'ur' });
    expect(new URLSearchParams(ur.next.split('?')[1]).get('lang')).toBe('ur');
  });

  test('no child on the phone and no roster row → the join screen link', async () => {
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect((await Join.autoBind({ n })).join).toMatch(/^\/quiz\/join\//);
  });
});

describe('the landing\'s own call style', () => {
  test('joinUrl and practiceJoinUrl answer synchronously (a string the landing can 302 to at once)', async () => {
    await Join.flags();
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect(typeof Join.joinUrl({ n, lang: 'bi' })).toBe('string');
    expect(T.verify(Join.joinUrl({ n, lang: 'bi' }).slice(Join.JOIN_PATH.length), 'j')).toEqual(expect.objectContaining({ n, l: 'en' }));
    expect(typeof Join.practiceJoinUrl({ uid: 'u-coach', lang: 'ur' })).toBe('string');
  });

  test('bindPick({kid, src}) with the landing\'s student id: this phone\'s child → bound; a stranger id → refused', async () => {
    seed({ students: [chatKid(0, 'Ali Testwala'), chatKid(1, 'Bina Testwala')] });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect(await Join.bindPick({ n, kid: 'f0000000-0000-4000-8000-00000000dead', src: 'quiz', device: DEVICE })).toEqual({ refused: 'child_unknown' });
    const out = await Join.bindPick({ n, kid: KIDS[1], src: 'quiz', device: DEVICE });
    expect(out.next).toMatch(/from=bind/);
    expect(fake.db.child_phone_bindings).toEqual([expect.objectContaining({ canonical_id: KIDS[1], via: 'guest' })]);
  });

  test('bindPick({kid, src:"device"}): a child who played on THIS device (not yet on the phone) → bound; another device → refused', async () => {
    const LOOSE = 'f0000000-0000-4000-8000-000000000177';
    seed({ students: [{ id: LOOSE, student_name: 'Noor Testwala', phone: null, list_id: null, is_active: true, status: 'active', self_reported_class: '2' }] });
    fake.db.quiz_sessions.push({ id: 's-1', student_id: LOOSE, device_ref: DEVICE, created_at: iso(Date.now() - 3600000) });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect(await Join.bindPick({ n, kid: LOOSE, src: 'device', device: OTHER_DEVICE })).toEqual({ refused: 'child_unknown' });
    const out = await Join.bindPick({ n, kid: LOOSE, src: 'device', device: DEVICE });
    expect(out.next).toMatch(/from=bind/);
    expect(fake.db.child_phone_bindings).toEqual([expect.objectContaining({ canonical_id: LOOSE, via: 'guest', phone_norm: PHONE })]);
    expect(events('web_quiz.bind_confirm')).toEqual([expect.objectContaining({ src: 'device' })]);
  });

  test('bindPick({quizDevice}): the quiz page\'s own device (its local wq_d) differs from this browser\'s cookie → the quiz page\'s device decides', async () => {
    const LOOSE = 'f0000000-0000-4000-8000-000000000178';
    seed({ students: [{ id: LOOSE, student_name: 'Noor Testwala', phone: null, list_id: null, is_active: true, status: 'active', self_reported_class: '2' }] });
    // played on /q/ with device A; the landing's fresh cookie is device B
    fake.db.quiz_sessions.push({ id: 's-2', student_id: LOOSE, device_ref: DEVICE, created_at: iso(Date.now() - 3600000) });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect(await Join.bindPick({ n, kid: LOOSE, src: 'device', device: OTHER_DEVICE, quizDevice: 'CCCCCCCCCCCCCCCCCCCCCC' })).toEqual({ refused: 'child_unknown' });
    const out = await Join.bindPick({ n, kid: LOOSE, src: 'device', device: OTHER_DEVICE, quizDevice: DEVICE });
    expect(out.next).toMatch(/from=bind/);
    expect(fake.db.child_phone_bindings).toEqual([expect.objectContaining({ canonical_id: LOOSE, via: 'guest', phone_norm: PHONE })]);
  });
});

describe('a family phone on a teacher\'s class list', () => {
  const rosterKid = (i, name, school = 'sch-1', extra = {}) => ({ id: KIDS[i], student_name: name, phone: null, parent_phone: `+${PHONE}`, list_id: 'list-1',
    school_id: school, is_active: true, status: 'active', merged_into: null, self_reported_class: '3', created_at: iso(Date.now() - 60000), ...extra });
  // a list made this school year (after 1 April PKT), and one made last school year
  const THIS_YEAR = [{ id: 'list-1', user_id: 'u-t1', is_active: true, created_at: iso(Date.now() - 86400000) },
    { id: 'list-2', user_id: 'u-t1', is_active: true, created_at: iso(Date.now() - 2 * 86400000) }];
  const lastYearAt = (() => { const y = new Date(Date.now() + 5 * 3600000); const yr = y.getUTCMonth() >= 3 ? y.getUTCFullYear() : y.getUTCFullYear() - 1; return `${yr}-01-15T00:00:00.000Z`; })();
  const LAST_YEAR = [{ id: 'list-old', user_id: 'u-t1', is_active: true, created_at: lastYearAt }];

  test('(1) the roster phone is offered its roster child; the ONLY write after "Yes, it\'s me" is one binding row — never a students write', async () => {
    seed({ students: [rosterKid(0, 'Zara Testwala')], lists: THIS_YEAR });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    const out = await Join.autoBind({ n, lang: 'ur' });
    expect(out.confirm.src).toBe('roster');
    expect(writes('child_phone_bindings')).toHaveLength(0);
    const picked = await Join.bindPick({ n, chip: out.confirm.kids[0].chip, lang: 'ur' });
    expect(picked.next).toMatch(/from=bind/);
    expect(writes('students')).toHaveLength(0);
    expect(writes('child_phone_bindings')).toHaveLength(1);
    expect(fake.db.child_phone_bindings[0]).toMatchObject({ canonical_id: KIDS[0], via: 'guest', phone_norm: PHONE });
    expect(events('web_quiz.bind_confirm')).toEqual([expect.objectContaining({ src: 'roster' })]);
  });

  test('(2) the chips carry first names only, never a surname, a school, a class or a phone; ≤ 4', async () => {
    seed({ students: [rosterKid(0, 'Zara Bibi Testwala'), rosterKid(1, 'Omar Testwala')], lists: THIS_YEAR });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    const out = await Join.autoBind({ n });
    expect(out.confirm.kids.length).toBeLessThanOrEqual(4);
    const dump = JSON.stringify(out);
    ['Testwala', 'Bibi', 'sch-1', 'list-1', PHONE].forEach((w) => expect(dump).not.toContain(w));
    out.confirm.kids.forEach((k) => expect(Object.keys(k).sort()).toEqual(['animal', 'chip', 'first']));
  });

  test('(3) a number on rows of TWO schools, or > 4 children → no chips: the role question', async () => {
    seed({ students: [rosterKid(0, 'Zara Testwala', 'sch-1'), rosterKid(1, 'Omar Testwala', 'sch-2')], lists: THIS_YEAR });
    let n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect(await Join.autoBind({ n })).toEqual({ none: true });
    seed({ students: [0, 1, 2, 3].map((i) => rosterKid(i, `Kid${i} Testwala`)).concat([{ ...rosterKid(0, 'Extra Testwala'), id: 'f0000000-0000-4000-8000-000000000199' }]), lists: THIS_YEAR });
    n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect(await Join.autoBind({ n })).toEqual({ none: true });
    expect(writes('child_phone_bindings')).toHaveLength(0);
  });

  test('(4) switch OFF → nothing for a roster phone (the landing\'s caller keeps today\'s path)', async () => {
    seed({ join: false, students: [rosterKid(0, 'Zara Testwala')], lists: THIS_YEAR });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect(await Join.autoBind({ n })).toEqual({ off: true });
    expect(await Join.bindPick({ n, chip: T.chipId('go', KIDS[0]) })).toEqual({ off: true });
    expect(writes('child_phone_bindings')).toHaveLength(0);
  });

  test('(5) a last-year roster row → no chips, and its child cannot be picked', async () => {
    seed({ students: [rosterKid(0, 'Zara Testwala', 'sch-1', { list_id: 'list-old' })], lists: LAST_YEAR });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    const out = await Join.autoBind({ n });
    expect(out.confirm).toBeUndefined();
    // nor the role question: last year's roster says nothing about this phone today, so the join screen
    expect(out.none).toBeUndefined();
    expect(out.join).toMatch(/^\/quiz\/join\//);
    expect(await Join.bindPick({ n, chip: T.chipId('go', KIDS[0]) })).toEqual({ refused: 'child_unknown' });
    expect(await Join.bindPick({ n, kid: KIDS[0], src: 'roster' })).toEqual({ refused: 'child_unknown' });
    expect(writes('child_phone_bindings')).toHaveLength(0);
  });

  test('(5b) only left or merged rows on this year\'s list → the join screen, never the role question', async () => {
    seed({ students: [rosterKid(0, 'Gone Testwala', 'sch-1', { is_active: false }), rosterKid(1, 'Moved Testwala', 'sch-1', { merged_into: KIDS[3] })], lists: THIS_YEAR });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    const out = await Join.autoBind({ n });
    expect(out.none).toBeUndefined();
    expect(out.join).toMatch(/^\/quiz\/join\//);
  });

  test('(6) the filters run before the limit: five left/merged rows or five last-year rows never hide this year\'s child', async () => {
    const OLD = [0, 1, 2, 3, 4].map((i) => `f0000000-0000-4000-8000-00000000020${i}`);
    const left = OLD.map((id, i) => ({ ...rosterKid(0, `Gone${i} Testwala`), id, ...(i % 2 ? { is_active: false } : { merged_into: KIDS[3] }) }));
    seed({ students: [...left, rosterKid(1, 'Omar Testwala')], lists: THIS_YEAR });
    let n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect((await Join.autoBind({ n })).confirm.kids.map((k) => k.first)).toEqual(['Omar']);
    const old = OLD.map((id, i) => ({ ...rosterKid(0, `Old${i} Testwala`, 'sch-1', { list_id: 'list-old' }), id }));
    seed({ students: [...old, rosterKid(1, 'Omar Testwala', 'sch-1', { list_id: 'list-2' })], lists: [...LAST_YEAR, ...THIS_YEAR] });
    n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect((await Join.autoBind({ n })).confirm.kids.map((k) => k.first)).toEqual(['Omar']);
  });
});

describe('failure: a failed binding leaves no orphan child', () => {
  test('the binder cannot write → the new row is retired (is_active false), the answer is an error, no key', async () => {
    const Repo = require('../../../shared/services/quiz/child-phone-bindings.repo');
    jest.spyOn(Repo, 'insert').mockResolvedValue(null);
    const { t } = await landing();
    expect(await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE })).toEqual({ error: 'unavailable' });
    expect(fake.db.students).toEqual([expect.objectContaining({ student_name: 'Sara', is_active: false })]);
    expect(writes('user_feature_first_use')).toHaveLength(0);
  });
});

describe('failure: each write refused at the database, alone', () => {
  const { logToFile } = require('../../../shared/utils/logger');
  // the write fails as supabase-js reports it ({ data: null, error }); every other call is untouched
  function failOnly(table, op) {
    const prev = supabase.from;
    supabase.from = (tb) => {
      const b = prev(tb);
      if (tb !== table) return b;
      const orig = b[op];
      b[op] = (...a) => { orig(...a); b.then = (res, rej) => Promise.resolve({ data: null, error: { message: 'injected', code: 'XX000' } }).then(res, rej); return b; };
      return b;
    };
  }

  test('the students insert fails → "unavailable", no binding, no child identity, no door key, the error logged', async () => {
    const { t } = await landing();
    failOnly('students', 'insert');
    expect(await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE })).toEqual({ error: 'unavailable' });
    expect(fake.db.child_phone_bindings).toEqual([]);
    expect(fake.db.child_identity).toEqual([]);
    expect(writes('user_feature_first_use')).toHaveLength(0);
    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('could not create the child'), { error: 'injected' }, 'error');
  });

  test('the binding insert fails → "unavailable" (never "joined"), the new row retired, no door key', async () => {
    const { t } = await landing();
    failOnly('child_phone_bindings', 'insert');
    const out = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    expect(out).toEqual({ error: 'unavailable' });
    expect(fake.db.child_phone_bindings).toEqual([]);
    expect(fake.db.students).toEqual([expect.objectContaining({ student_name: 'Sara', is_active: false })]);
    expect(writes('user_feature_first_use')).toHaveLength(0);
  });

  test('the binding AND the retire fail → still "unavailable", and the row left active is logged as an error', async () => {
    const { t } = await landing();
    failOnly('child_phone_bindings', 'insert');
    failOnly('students', 'update');
    expect(await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE })).toEqual({ error: 'unavailable' });
    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('row not retired'), { error: 'injected' }, 'error');
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

// last in the file: it loads a fresh module registry (the persona module mocked), wired to the same fake database
describe('the sandbox walk-through persona (switch off = today)', () => {
  test('a teacher\'s phone playing a new family (as: fresh) joins and binds like a family; with no persona → refused as today', async () => {
    seed({ user: TEACHER_USER });
    const l1 = await landing(TEACHER_USER);
    expect((await Join.join({ t: l1.t, grade: 3, name: 'Sara', device: DEVICE })).refused).toBe('teacher_phone');
    expect(writes('students')).toHaveLength(0);
    jest.resetModules();
    jest.doMock('../../../shared/services/first-touch/walk-persona', () => ({ get: async () => ({ as: 'fresh', since: Date.now() }) }));
    const sb = require('../../../shared/config/supabase');
    sb.from = supabase.from; sb.rpc = supabase.rpc;
    const J2 = require('../../../shared/services/quiz/web-quiz-student-join');
    const N2 = require('../../../shared/services/first-touch/go-nonce');
    const n = await N2.mint({ phoneNorm: PHONE, userId: TEACHER_USER.id });
    const out = await J2.join({ t: J2.signJoin({ n, lang: 'en' }), grade: 3, name: 'Sara', device: OTHER_DEVICE });
    expect(out.next).toMatch(/^\/h\//);
    expect(fake.db.child_phone_bindings).toEqual([expect.objectContaining({ via: 'guest', phone_norm: PHONE })]);
    // the binder reads the same module: a teacher-mode bind on that phone is a family's bind, not a refusal
    const B2 = require('../../../shared/services/quiz/web-quiz-bind.service');
    expect(await B2.bindOnPhone({ phone: PHONE, canonicalId: fake.db.students[0].id, via: 'guest', mode: 'teacher' })).toMatchObject({ ok: true, outcome: 'bound' });
  });
});
