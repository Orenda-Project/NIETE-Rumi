'use strict';
/**
 * The join's refusal is VISIBLE (G6 of the keyword-entry review, 27 Oct 2026).
 *
 * Production, 7 days to 27 Oct 2026: web_quiz.join_grade 28, web_quiz.join_done 0. quiz_student_join is on and its hard
 * parent web_quiz_phone_bind is absent (off), so every child who picked a grade and typed a first name was answered
 * {off:true} at the last step, and NOTHING was logged: how many children were refused there, versus left at the grade
 * chips, could not be told. The refusal now logs web_quiz.join_refused { reason: 'bind_off' } (ids only), on the two
 * writes a child asks for: join() (the name screen's "Let's go!") and bindPick() (the landing sheet's "Yes, it's me").
 * The answer itself ({off:true}) and every write count are unchanged; the bind switch is NOT turned on here.
 * Real join service; Supabase, Redis, the WhatsApp send and the loggers are the faked boundaries (the -seam harness).
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
function seed({ join = true, joinValue = true, bind = true, students = [], bindings = [], user = UNKNOWN_USER, lists = [], early, adv, oneButton } = {}) {
  const settings = { web_quiz_hub: true, web_quiz_identity_canon: true };
  if (bind !== null) settings.web_quiz_phone_bind = bind;
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


const refusals = () => events('web_quiz.join_refused');

describe('quiz_student_join ON, web_quiz_phone_bind OFF (production today)', () => {
  test.each([['absent', null], ['false', false], ['"yes"', 'yes']])('bind row %s: join() answers {off:true}, writes nothing, and logs join_refused bind_off (ids only)', async (_l, bind) => {
    seed({ bind });
    const { t } = await landing();
    expect(await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE })).toEqual({ off: true });
    expect(refusals()).toEqual([expect.objectContaining({ reason: 'bind_off' })]);
    ['students', 'child_phone_bindings', 'child_identity', 'user_feature_first_use'].forEach((tb) => expect(writes(tb)).toHaveLength(0));
    expect(sends()).toBe(0);
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('Sara');
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(PHONE);
  });

  test('bindPick() ("Yes, it\'s me" on the landing sheet): {off:true} and join_refused bind_off', async () => {
    seed({ bind: false });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect(await Join.bindPick({ n, chip: 'x' })).toEqual({ off: true });
    expect(refusals()).toEqual([expect.objectContaining({ reason: 'bind_off' })]);
    expect(writes('child_phone_bindings')).toHaveLength(0);
  });

  test('the landing\'s offer (autoBind, a read on every landing) is not a refusal: no event', async () => {
    seed({ bind: false });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    expect(await Join.autoBind({ n })).toEqual({ off: true });
    expect(refusals()).toHaveLength(0);
  });

  test('a bad request (no name) is answered before the bind check: no refusal event', async () => {
    seed({ bind: false });
    const { t } = await landing();
    expect(await Join.join({ t, grade: 3, name: '', device: DEVICE })).toEqual({ error: 'bad_request', why: 'name' });
    expect(refusals()).toHaveLength(0);
  });
});

describe('quiz_student_join OFF: the feature is off, nothing is refused (no event)', () => {
  test('join() and bindPick() answer {off:true} with no join_refused', async () => {
    seed({ join: false, bind: false });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: UNKNOWN_USER.id });
    const t = Join.signJoin({ n, lang: 'en' });
    expect(await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE })).toEqual({ off: true });
    expect(await Join.bindPick({ n, chip: 'x' })).toEqual({ off: true });
    expect(refusals()).toHaveLength(0);
  });
});

describe('both ON: a join is not refused (control)', () => {
  test('join() writes the child and logs no join_refused', async () => {
    seed();
    const { t } = await landing();
    const out = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    expect(out.next).toMatch(/^\/h\//);
    expect(refusals()).toHaveLength(0);
  });
});
