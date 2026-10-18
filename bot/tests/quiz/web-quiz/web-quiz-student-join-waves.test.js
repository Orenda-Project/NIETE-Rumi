'use strict';
/**
 * The join page's wave counter (quiz_join_fast, default OFF): what one `POST /api/wq/join` for a fresh phone, the
 * page's shell answer and the grade tap wait for. Every Supabase read or write and every Redis call takes RT_MS and
 * gets a WAVE, 1 + the highest wave of the calls already finished when it started; the request waits for the highest
 * wave. Cold = a fresh process, warm = the next join inside 30 s, stale = 31 s later (every 30 s cache expired).
 *
 * OFF (absent, false, the string 'true', 1, a failed read) → today's calls in today's order and today's answer, byte
 * for byte (recorded on the base). ON → the independent reads start together, the writes keep their order, the answer
 * is the same bytes, and the waves fall under the ceilings below.
 *
 * Supabase, Redis and the loggers are the boundaries; every first-party module on the path runs for real.
 */
process.env.STUDENT_MODE_ENABLED = 'true';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  const hook = { on: null };
  const rt = (name, fn) => jest.fn(async (...a) => { if (hook.on) await hook.on(`redis.${name}`); return fn(...a); });
  return {
    __keys: keys,
    __hook: hook,
    get: rt('get', async (k) => (keys.has(k) ? keys.get(k) : null)),
    set: rt('set', async (k, v) => { keys.set(k, v); return true; }),
    setNX: rt('setNX', async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    delete: rt('delete', async (k) => keys.delete(k)),
    incr: rt('incr', async (k) => { const v = (Number(keys.get(k)) || 0) + 1; keys.set(k, v); return v; }),
    expire: rt('expire', async () => true),
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

const crypto = require('crypto');
const { makeFake } = require('./fake-supabase');
const { fixturePhone } = require('./fixture-phone');

const RT_MS = 8;
// A fixed clock (Saturday 17 Oct 2026, 11:00 PKT): tokens, rows and the 30 s caches read it; the timers stay real.
const NOW = Date.UTC(2026, 9, 17, 6, 0, 0);
const FAST_KEY = 'quiz_join_fast';
const user = (n) => ({ id: `u-new-${n}`, phone_number: fixturePhone(800 + n), registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en' });
const TEACHER = { ...user(9), id: 'u-teacher-9', registration_completed: true, name: 'Teacher Testwala' };

// ── ceilings (ON): measured on this fixture, a fresh phone; database waves are what costs (~175 ms each on sandbox) ──
const CEIL = { coldWaves: 18, coldDb: 8, warmWaves: 17, warmDb: 7, staleWaves: 18, staleDb: 8, pageCold: 1, gradeCold: 2 };

let calls = [];
let doneMax = 0;
let fake;
let uuidN = 0;
async function roundTrip(what) {
  const rec = { what, wave: doneMax + 1 };
  calls.push(rec);
  await new Promise((r) => setTimeout(r, RT_MS));
  doneMax = Math.max(doneMax, rec.wave);
}

function seed(fastValue, { failFast = false, extra = {} } = {}) {
  const settings = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true, web_quiz_events_v2: true,
    quiz_student_join: true, quiz_join_early_tap: true, web_quiz_home_v3: true, ...extra };
  if (fastValue !== undefined) settings[FAST_KEY] = fastValue;
  fake = makeFake({
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    users: [1, 2, 3, 4, 5, 6].map(user).concat([TEACHER]), students: [], child_phone_bindings: [], child_identity: [], user_feature_first_use: [],
    quiz_sessions: [], class_enrollments: [], student_lists: [], class_teachers: [], quizzes: [{ id: 'q-t', teacher_id: TEACHER.id }], coaching_sessions: [],
    lesson_plans: [], training_assessment_attempts: [], assessment_requests: [], message_ledger: [],
  });
  const supabase = require('../../../shared/config/supabase');
  supabase.from = (t) => {
    if (t === 'students') (fake.db.students || []).forEach((r) => { if (!('is_active' in r)) r.is_active = true; if (!('status' in r)) r.status = 'active'; });
    const b = fake.from(t);
    b.or = () => b;
    b.upsert = (row) => b.insert(row);
    const then = b.then;
    // a failed read of the one switch read (failFast): every app_settings read that asks for the fast key errors
    const inFn = b.in;
    let asksFast = false;
    b.in = (c, vs) => { if (c === 'key' && (vs || []).includes(FAST_KEY)) asksFast = true; return inFn(c, vs); };
    b.then = (res, rej) => roundTrip(`db.${t}`).then(() => (failFast && asksFast ? { data: null, error: { message: 'boom' } } : then.call(b, (x) => x))).then(res, rej);
    return b;
  };
  supabase.rpc = async (...a) => { await roundTrip(`rpc.${a[0]}`); return fake.rpc(...a); };
  fake.rpcResult = { data: null, error: { code: '42883', message: 'absent' } };
}

let Join;
let GoNonce;
let redis;
const SAVED = { ...process.env };
beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => { jest.useRealTimers(); process.env = SAVED; });
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test' };
});

function boot(fastValue, opts) {
  jest.resetModules();
  jest.setSystemTime(NOW);
  uuidN = 0;
  // the inserted rows' ids are the same on every run, so the answer (a signed home link) is too
  jest.spyOn(crypto, 'randomUUID').mockImplementation(() => `f0000000-0000-4000-8000-${String(++uuidN).padStart(12, '0')}`);
  seed(fastValue, opts);
  redis = require('../../../shared/services/cache/railway-redis.service');
  redis.__keys.clear();
  GoNonce = require('../../../shared/services/first-touch/go-nonce');
  Join = require('../../../shared/services/quiz/web-quiz-student-join');
}
const settle = () => new Promise((r) => setTimeout(r, 12 * RT_MS));

/** One measured call: its answer, its waves, its database waves and its calls in the order they were made. */
async function measure(fn) {
  await settle();
  calls = [];
  doneMax = 0;
  redis.__hook.on = roundTrip;
  const out = await fn();
  redis.__hook.on = null;
  const list = calls.slice();
  const dbWaves = new Set(list.filter((c) => !c.what.startsWith('redis.')).map((c) => c.wave)).size;
  const r = { out: JSON.stringify(out), waves: doneMax, dbWaves, seq: list.map((c) => c.what), n: list.length };
  await settle();
  return r;
}

async function landing(u, lang = 'ur') {
  const n = await GoNonce.mint({ phoneNorm: u.phone_number, userId: u.id });
  return Join.signJoin({ n, lang });
}
const device = (n) => String.fromCharCode(64 + n).repeat(22);
async function oneJoin(n, name = 'Sara', u = user(n)) {
  const t = await landing(u);
  return measure(() => Join.join({ t, grade: 3, name, device: device(n) }));
}
/** A fresh phone's join, cold / warm (the next join inside 30 s) / stale (31 s later). */
async function coldWarmStale(fastValue, opts) {
  boot(fastValue, opts);
  const cold = await oneJoin(1);
  const warm = await oneJoin(2);
  jest.setSystemTime(NOW + 31 * 1000);
  const stale = await oneJoin(3);
  return { cold, warm, stale };
}
const writesOf = () => fake.calls.filter((c) => ['insert', 'update', 'delete'].includes(c.op)).map((c) => `${c.table}.${c.op}`);

// ── recorded on the base (sandbox 14de0aaac, before this change): today's calls, in order, and today's answers ──
const BASE = require('./web-quiz-student-join-waves.golden.json');

describe('quiz_join_fast OFF: today\'s calls, in today\'s order, and today\'s answer', () => {
  test.each([
    ['absent', undefined], ['false', false], ['the string "true"', 'true'], ['the JSON string \'"true"\'', '"true"'], ['1', 1], ['{}', {}],
  ])('switch %s → the base\'s cold / warm / stale join, call for call and byte for byte', async (_label, value) => {
    const r = await coldWarmStale(value);
    expect({ cold: r.cold.seq, warm: r.warm.seq, stale: r.stale.seq }).toEqual(BASE.join.seq);
    expect({ cold: r.cold.out, warm: r.warm.out, stale: r.stale.out }).toEqual(BASE.join.out);
  });
  test('a failed read of the switch → today\'s join (off), never a half-fast one', async () => {
    const r = await coldWarmStale(true, { failFast: true });
    // the read that asks for the fast key fails → every join switch reads off → {off:true}, as today on a failed read
    expect(JSON.parse(r.cold.out)).toEqual({ off: true });
  });
  test('the page\'s shell answer and the grade tap: today\'s calls and bytes', async () => {
    boot(undefined);
    const t = await landing(user(5));
    const page = await measure(() => Join.pageInfo({ t }));
    const grade = await measure(() => Join.gradeTap({ t, grade: 3, device: device(5) }));
    expect({ page: page.seq, grade: grade.seq }).toEqual(BASE.page.seq);
    expect({ page: page.out, grade: grade.out }).toEqual(BASE.page.out);
  });
});

describe('quiz_join_fast ON: the same answer and the same writes, in fewer waves', () => {
  test('cold / warm / stale under the ceilings; the answer is the OFF bytes; the writes keep their order', async () => {
    const off = await coldWarmStale(undefined);
    const offWrites = writesOf();
    const on = await coldWarmStale(true);
    const onWrites = writesOf();
    const row = (x) => `${x.waves} waves (${x.dbWaves} database) / ${x.n} calls`;
    console.log(`join waves: OFF cold ${row(off.cold)}, warm ${row(off.warm)}, stale ${row(off.stale)}\n`
      + `            ON  cold ${row(on.cold)}, warm ${row(on.warm)}, stale ${row(on.stale)}`);
    expect({ cold: on.cold.out, warm: on.warm.out, stale: on.stale.out }).toEqual({ cold: off.cold.out, warm: off.warm.out, stale: off.stale.out });
    expect(JSON.parse(on.cold.out).next).toMatch(/^\/h\/[A-Za-z0-9_.-]+\?from=join&kid=[0-9a-f]{16}&lang=ur$/);
    expect(onWrites).toEqual(offWrites);
    expect(on.cold.waves).toBeLessThanOrEqual(CEIL.coldWaves);
    expect(on.cold.dbWaves).toBeLessThanOrEqual(CEIL.coldDb);
    expect(on.warm.waves).toBeLessThanOrEqual(CEIL.warmWaves);
    expect(on.warm.dbWaves).toBeLessThanOrEqual(CEIL.warmDb);
    expect(on.stale.waves).toBeLessThanOrEqual(CEIL.staleWaves);
    expect(on.stale.dbWaves).toBeLessThanOrEqual(CEIL.staleDb);
  });

  test('the join switches are ONE app_settings read when the caches are cold (join + identity + hub + early tap)', async () => {
    boot(true);
    const r = await measure(() => Join.flags());
    expect(r.seq).toEqual(['db.app_settings']);
    expect(JSON.parse(r.out)).toMatchObject({ on: true, bind: true, earlyTap: true });
    // OFF: today's four reads in a row
    boot(undefined);
    const o = await measure(() => Join.flags());
    expect(o.seq).toEqual(['db.app_settings', 'db.app_settings', 'db.app_settings', 'db.app_settings']);
    expect(o.waves).toBe(4);
    const { fast, ...same } = JSON.parse(r.out);
    expect(fast).toBe(true);
    expect(same).toEqual(JSON.parse(o.out));
  });

  test('the hub\'s stale wave: the join flags with the hub\'s own flags warm are one read ON, two in a row OFF', async () => {
    for (const [value, want] of [[true, 1], [undefined, 2]]) {
      boot(value);
      await Join.flags();
      jest.setSystemTime(NOW + 31 * 1000);
      // the hub has just read its own switches (identity + hub flags warm); the join's 30 s cache is the stale one
      await require('../../../shared/services/quiz/web-quiz-identity-flags').flags();
      const r = await measure(() => Join.flags());
      expect(r.waves).toBe(want);
    }
  });

  test('the page\'s shell answer: one wave cold ON (four OFF); the grade tap under its ceiling; the same bytes', async () => {
    boot(true);
    const t = await landing(user(5));
    const page = await measure(() => Join.pageInfo({ t }));
    const grade = await measure(() => Join.gradeTap({ t, grade: 3, device: device(5) }));
    expect(page.waves).toBe(CEIL.pageCold);
    expect(grade.waves).toBeLessThanOrEqual(CEIL.gradeCold);
    expect({ page: page.out, grade: grade.out }).toEqual(BASE.page.out);
  });

  test.each([
    ['a teacher\'s phone → refused, practice offered', async () => oneJoin(6, 'Sara', TEACHER)],
    ['the same first name on the phone → "Is this you?"', async () => { await oneJoin(4, 'Sara'); return oneJoin(4, 'Sara'); }],
    ['five children on one phone → refused (max_kids)', async () => {
      for (const nm of ['Ali', 'Dua', 'Ema', 'Fiza']) await oneJoin(4, nm);
      return oneJoin(4, 'Hana');
    }],
  ])('%s: the same answer and writes ON as OFF', async (_label, act) => {
    boot(undefined);
    const off = await act();
    const offWrites = writesOf();
    boot(true);
    const on = await act();
    expect(on.out).toEqual(off.out);
    expect(writesOf()).toEqual(offWrites);
  });
});

describe('the teacher check side by side (activityAll) answers as the serial one (activity)', () => {
  const tables = ['quizzes', 'coaching_sessions', 'lesson_plans', 'student_lists', 'training_assessment_attempts', 'assessment_requests', 'class_teachers'];
  test.each([
    ['nothing', {}], ...tables.map((t) => [`a ${t} row`, { hit: t }]), ...tables.map((t) => [`a failed ${t} read`, { fail: t }]),
    ['a failed early read before a later hit', { fail: 'coaching_sessions', hit: 'assessment_requests' }],
    ['an early hit before a later failed read', { hit: 'coaching_sessions', fail: 'assessment_requests' }],
  ])('%s → the same verdict', async (_label, { hit, fail }) => {
    boot(undefined);
    const supabase = require('../../../shared/config/supabase');
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === fail) b.then = (res, rej) => Promise.resolve({ data: null, count: null, error: { message: 'boom' } }).then(res, rej);
      return b;
    };
    if (hit) fake.db[hit].push(hit === 'quizzes' ? { teacher_id: 'u-x' } : hit === 'class_teachers' ? { teacher_user_id: 'u-x', is_active: true } : { user_id: 'u-x', gamma_url: 'g' });
    const I = require('../../../shared/services/student-ingress-identity');
    expect(await I.activityAll('u-x')).toBe(await I.activity('u-x'));
  });
});

describe('quiz_join_wait_word: the page\'s shell answer names it, read in the join\'s own switch read', () => {
  const WAIT_KEY = 'quiz_join_wait_word';
  const pageOf = async (fastValue, extra) => {
    boot(fastValue, { extra });
    const t = await landing(user(5));
    return measure(() => Join.pageInfo({ t }));
  };
  test.each([[undefined], [true]])('ON (JSON true; quiz_join_fast %s) → waitWord: true and nothing else changes; no read of its own', async (fastValue) => {
    const off = await pageOf(fastValue, {});
    const on = await pageOf(fastValue, { [WAIT_KEY]: true });
    expect(JSON.parse(on.out)).toEqual({ ...JSON.parse(off.out), waitWord: true });
    expect(on.seq).toEqual(off.seq);
  });
  test.each([['false', false], ['the string "true"', 'true'], ['the JSON string \'"true"\'', '"true"'], ['1', 1], ['{}', {}]])('%s → today\'s bytes', async (_l, value) => {
    const r = await pageOf(undefined, { [WAIT_KEY]: value });
    expect(r.out).toEqual(BASE.page.out.page);
    expect(r.seq).toEqual(BASE.page.seq.page);
  });
  test('the join switch off → off, whatever the waiting-line switch says', async () => {
    const r = await pageOf(undefined, { [WAIT_KEY]: true, quiz_student_join: false });
    expect(JSON.parse(r.out)).toEqual({ off: true });
  });
  test('ON: the join itself answers the same bytes (the switch changes only the page)', async () => {
    boot(undefined, { extra: { [WAIT_KEY]: true } });
    const on = await oneJoin(1);
    expect(on.out).toEqual(BASE.join.out.cold);
  });
});
