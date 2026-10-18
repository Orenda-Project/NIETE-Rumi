'use strict';
/**
 * The first minute's other waits, counted like the join's (web-quiz-student-join-waves.test.js): the `/quiz` landing's
 * offer (autoBind), the confirm sheet's "Yes, it's me" (bindPick), the grade tap, and the door's teacher check. Every
 * Supabase read or write and every Redis call takes RT_MS and gets a WAVE, 1 + the highest wave of the calls already
 * finished when it started; the request waits for the highest wave.
 *
 * quiz_join_fast (the join's switch, JSON true only) also starts the landing's and the sheet's independent reads
 * together. quiz_door_activity_once (its own switch, JSON true only, read with the one door's switches and never on its
 * own) counts the door's seven teacher-activity tables in one round trip instead of seven. OFF (absent, false, the
 * string 'true', 1, {}) → today's calls in today's order and today's answer, byte for byte (recorded on the base).
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
const { fixturePhone, maskFixturePhones } = require('./fixture-phone');

const RT_MS = 8;
// A fixed clock (Saturday 17 Oct 2026, 11:00 PKT): tokens, rows and the 30 s caches read it; the timers stay real.
const NOW = Date.UTC(2026, 9, 17, 6, 0, 0);
const FAST_KEY = 'quiz_join_fast';
const ONCE_KEY = 'quiz_door_activity_once';
const OFF_VALUES = [['absent', undefined], ['false', false], ['the string "true"', 'true'], ['the JSON string \'"true"\'', '"true"'], ['1', 1], ['{}', {}]];

const phone = (n) => fixturePhone(820 + n);
const user = (n) => ({ id: `u-fam-${n}`, phone_number: phone(n), registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en' });
// a teacher by activity only (a coaching session; no registration, no name): the door counts the tables to know it
const ACTIVE = { ...user(13), id: 'u-active-13' };
// a teacher by identity (registered): no table is counted
const TEACHER = { ...user(9), id: 'u-teacher-9', registration_completed: true, name: 'Teacher Testwala' };
const BOUND_UNTIL = '2027-10-17T06:00:00.000Z';

// ── ceilings (ON), measured on this fixture; database waves are what costs (~175 ms each on sandbox) ──
const CEIL = {
  autoBind: { waves: 4, db: 3, settings: 1 },
  // the test-persona switch (sandbox only) may be read beside the teacher check: at most once, never a wave of its own
  bindPick: { waves: 12, db: 7, settings: 1, persona: 1 },
  grade: { waves: 2, db: 0, settings: 1 },
  doorDrop: 6,
};

let calls = [];
let doneMax = 0;
let fake;
let uuidN = 0;
async function roundTrip(what, persona = false) {
  const rec = { what, wave: doneMax + 1, ...(persona ? { persona } : {}) };
  calls.push(rec);
  await new Promise((r) => setTimeout(r, RT_MS));
  doneMax = Math.max(doneMax, rec.wave);
}

/**
 * Phones by number: 1–3 a chat child not yet bound · 4 a chat child bound · 5–7 one roster child (one school, this
 * year) · 8 two roster children of two schools · 9 the teacher's, with a chat child · 10 nothing at all · 11 a child who
 * played on this device only · 12 a new phone for the door · 13 a teacher known by activity only.
 */
function seed({ fast, once } = {}) {
  const settings = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true, web_quiz_events_v2: true,
    quiz_student_join: true, quiz_join_early_tap: true, web_quiz_home_v3: true, quiz_maker_page: true, quiz_first_door: true, quiz_one_door: true };
  if (fast !== undefined) settings[FAST_KEY] = fast;
  if (once !== undefined) settings[ONCE_KEY] = once;
  const chat = (n, id = `s-chat-${n}`) => ({ id, student_name: 'Sara Testwala', self_reported_class: 'Grade 3', phone: phone(n), list_id: null,
    is_active: true, status: 'active', created_at: '2026-09-01T06:00:00.000Z' });
  const roster = (n, k, school) => ({ id: `s-ros-${n}${k}`, student_name: `${k === 'a' ? 'Ali' : 'Dua'} Testwala`, parent_phone: `+${phone(n)}`,
    list_id: `l-${n}${k}`, school_id: school, is_active: true, status: 'active', created_at: '2026-05-01T06:00:00.000Z' });
  fake = makeFake({
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    users: [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12].map(user).concat([TEACHER, ACTIVE]),
    students: [chat(1), chat(2), chat(3), chat(4), chat(9),
      roster(5, 'a', 'sch-1'), roster(6, 'a', 'sch-1'), roster(7, 'a', 'sch-1'), roster(8, 'a', 'sch-1'), roster(8, 'b', 'sch-2'),
      { id: 's-dev-11', student_name: 'Hana Testwala', self_reported_class: 'Grade 2', phone: null, list_id: null, is_active: true, status: 'active', created_at: '2026-09-01T06:00:00.000Z' }],
    student_lists: ['5a', '6a', '7a', '8a', '8b'].map((k) => ({ id: `l-${k}`, is_active: true, created_at: '2026-05-01T06:00:00.000Z', class_id: null })),
    child_phone_bindings: [{ id: 'b-4', canonical_id: 's-chat-4', phone_norm: phone(4), via: 'guest', revoked_at: null, expires_at: BOUND_UNTIL,
      bound_at: '2026-09-02T06:00:00.000Z', confirmed_at: '2026-09-02T06:00:00.000Z', phone_tomb: null, rebind_of: null }],
    quiz_sessions: [{ id: 'qs-11', student_id: 's-dev-11', device_ref: device(11), created_at: '2026-09-03T06:00:00.000Z' }],
    child_identity: [], user_feature_first_use: [], class_enrollments: [], class_teachers: [],
    quizzes: [{ id: 'q-t', teacher_id: TEACHER.id }], coaching_sessions: [{ id: 'cs-13', user_id: ACTIVE.id }],
    lesson_plans: [], training_assessment_attempts: [], assessment_requests: [], message_ledger: [],
  });
  const supabase = require('../../../shared/config/supabase');
  supabase.from = (t) => {
    const b = fake.from(t);
    b.or = () => b;
    b.upsert = (row) => b.insert(row);
    // the test-persona switch's own read (walk-persona.js; never made on production or staging) is marked, not renamed
    const inq = b.in;
    b.in = (col, vals) => { if (t === 'app_settings' && Array.isArray(vals) && vals.length === 1 && vals[0] === 'quiz_test_personas') b.persona = true; return inq.call(b, col, vals); };
    const then = b.then;
    b.then = (res, rej) => roundTrip(`db.${t}`, b.persona).then(() => then.call(b, (x) => x)).then(res, rej);
    return b;
  };
  supabase.rpc = async (...a) => { await roundTrip(`rpc.${a[0]}`); return fake.rpc(...a); };
  fake.rpcResult = { data: null, error: { code: '42883', message: 'absent' } };
}

let Join;
let GoNonce;
let T;
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

function boot(opts) {
  jest.resetModules();
  jest.setSystemTime(NOW);
  uuidN = 0;
  jest.spyOn(crypto, 'randomUUID').mockImplementation(() => `f0000000-0000-4000-8000-${String(++uuidN).padStart(12, '0')}`);
  // the links' nonces too, so an answer that carries a join link is the same bytes on every run
  jest.spyOn(crypto, 'randomBytes').mockImplementation((size) => Buffer.alloc(size, ++uuidN));
  seed(opts);
  redis = require('../../../shared/services/cache/railway-redis.service');
  redis.__keys.clear();
  GoNonce = require('../../../shared/services/first-touch/go-nonce');
  T = require('../../../shared/services/quiz/web-quiz-token');
  Join = require('../../../shared/services/quiz/web-quiz-student-join');
}
const settle = () => new Promise((r) => setTimeout(r, 12 * RT_MS));
function device(n) { return String.fromCharCode(64 + n).repeat(22); }

/** One measured call: its answer, its waves, its database waves, its settings reads and its calls in order. */
async function measure(fn) {
  await settle();
  calls = [];
  doneMax = 0;
  redis.__hook.on = roundTrip;
  const out = await fn();
  redis.__hook.on = null;
  const list = calls.slice();
  const dbWaves = new Set(list.filter((c) => !c.what.startsWith('redis.')).map((c) => c.wave)).size;
  // settings: the app_settings reads a production request makes (the test-persona switch's read, sandbox only, apart)
  const r = { out: JSON.stringify(maskFixturePhones(out)), waves: doneMax, dbWaves, settings: list.filter((c) => c.what === 'db.app_settings' && !c.persona).length,
    personaReads: list.filter((c) => c.persona).length,
    seq: list.map((c) => c.what), n: list.length };
  await settle();
  return r;
}
const writesOf = () => fake.calls.filter((c) => ['insert', 'update', 'delete'].includes(c.op)).map((c) => `${c.table}.${c.op}`);
const nonce = (u) => GoNonce.mint({ phoneNorm: u.phone_number, userId: u.id });

// ── the landing and the sheet: cold (a fresh process), warm (the next phone inside 30 s), stale (31 s later) ──
const LANDING = {
  chat: [1, 2, 3],
  bound: [4],
  roster: [5, 6, 7],
  twoSchools: [8],
  nothing: [10],
};
const PICKS = {
  chat: { phones: [1, 2, 3], args: (n) => ({ chip: T.chipId('go', `s-chat-${n}`) }) },
  bound: { phones: [4], args: () => ({ kid: 's-chat-4' }) },
  roster: { phones: [5, 6, 7], args: (n) => ({ kid: `s-ros-${n}a` }) },
  teacher: { phones: [9], who: () => TEACHER, args: () => ({ kid: 's-chat-9' }) },
  device: { phones: [11], args: (n) => ({ kid: 's-dev-11', src: 'device', quizDevice: device(n) }) },
  stranger: { phones: [10], args: () => ({ kid: 's-nobody' }) },
};
const whoOf = (n, spec) => (spec && spec.who ? spec.who() : user(n));

/** Each phone of a row in turn; the third (when there is one) 31 s after the first. */
async function runRow(phones, act) {
  const out = [];
  for (let i = 0; i < phones.length; i += 1) {
    if (i === 2) jest.setSystemTime(NOW + 31 * 1000);
    out.push(await act(phones[i]));
  }
  return out;
}
async function landingRow(opts, name) {
  boot(opts);
  return runRow(LANDING[name], async (n) => { const nn = await nonce(user(n)); return measure(() => Join.autoBind({ n: nn, lang: 'ur' })); });
}
async function pickRow(opts, name) {
  boot(opts);
  const spec = PICKS[name];
  const rows = await runRow(spec.phones, async (n) => {
    const nn = await nonce(whoOf(n, spec));
    return measure(() => Join.bindPick({ n: nn, device: device(n), lang: 'ur', ...spec.args(n) }));
  });
  return { rows, writes: writesOf() };
}
async function gradeRow(opts) {
  boot(opts);
  return runRow([1, 2, 3], async (n) => {
    const t = Join.signJoin({ n: await nonce(user(n)), lang: 'ur' });
    return measure(() => Join.gradeTap({ t, grade: 3, device: device(n) }));
  });
}

// ── the door: the one door's resolver and the chat door's classify, with the one door's switches read (as every door
//    path reads them before it decides); a fresh phone, a teacher by activity, a teacher by identity ──
const DOOR_USERS = { fresh: () => user(12), active: () => ACTIVE, registered: () => TEACHER };
async function doorRow(opts, name, which) {
  boot(opts);
  await require('../../../shared/services/first-touch/one-door.flags').flags();
  const u = DOOR_USERS[name]();
  if (which === 'role') {
    const Role = require('../../../shared/services/first-touch/role.service');
    return measure(() => Role.resolveRole({ user: { id: u.id }, phone: u.phone_number }));
  }
  const Ingress = require('../../../shared/services/student-ingress');
  return measure(() => Ingress.classify({ user: { ...u }, phone: u.phone_number, body: 'quiz' }));
}

// ── recorded on the base (sandbox + the join's fast path, before this change): today's calls, in order, and answers ──
const BASE = require('./web-quiz-landing-bind-waves.golden.json');
const shape = (rows) => rows.map((r) => ({ seq: r.seq, out: r.out }));
function matchGolden(path, observed) {
  const want = path.split('.').reduce((o, k) => (o ? o[k] : undefined), BASE);
  expect(observed).toEqual(want);
}

describe('switches OFF: today\'s calls, in today\'s order, and today\'s answers', () => {
  test.each(OFF_VALUES)('quiz_join_fast %s → the landing\'s offer, the sheet\'s "Yes, it\'s me" and the grade tap as the base', async (_l, value) => {
    for (const name of Object.keys(LANDING)) matchGolden(`autoBind.${name}`, shape(await landingRow({ fast: value }, name)));
    for (const name of Object.keys(PICKS)) {
      const r = await pickRow({ fast: value }, name);
      matchGolden(`bindPick.${name}`, { rows: shape(r.rows), writes: r.writes });
    }
    matchGolden('grade', shape(await gradeRow({ fast: value })));
  });
  test.each(OFF_VALUES)('quiz_door_activity_once %s → the door\'s calls and verdicts as the base', async (_l, value) => {
    for (const which of ['role', 'classify']) {
      for (const name of Object.keys(DOOR_USERS)) matchGolden(`door.${which}.${name}`, shape([await doorRow({ once: value }, name, which)]));
    }
  });
  test('quiz_door_activity_once ON with the one door\'s switches not read in the last 30 s → today\'s serial count (it never reads a switch of its own)', async () => {
    boot({ once: true });
    const u = user(12);
    const r = await measure(() => require('../../../shared/services/first-touch/role.service').resolveRole({ user: { id: u.id }, phone: u.phone_number }));
    boot({});
    const o = await measure(() => require('../../../shared/services/first-touch/role.service').resolveRole({ user: { id: u.id }, phone: u.phone_number }));
    expect(r.seq).toEqual(o.seq);
    expect(r.out).toEqual(o.out);
  });
});

describe('quiz_join_fast ON: the landing\'s offer and "Yes, it\'s me" give the same answers and writes in fewer waves', () => {
  test.each(Object.keys(LANDING))('the landing\'s offer, %s: the same answer, under the ceilings', async (name) => {
    const off = await landingRow({}, name);
    const on = await landingRow({ fast: true }, name);
    console.log(`autoBind ${name}: OFF ${off.map((x) => `${x.waves}/${x.dbWaves}db/${x.n}`).join(' ')} → ON ${on.map((x) => `${x.waves}/${x.dbWaves}db/${x.n}`).join(' ')}`);
    expect(on.map((x) => x.out)).toEqual(off.map((x) => x.out));
    on.forEach((x, i) => {
      expect(x.waves).toBeLessThanOrEqual(Math.min(CEIL.autoBind.waves, off[i].waves));
      expect(x.dbWaves).toBeLessThanOrEqual(CEIL.autoBind.db);
      expect(x.settings).toBeLessThanOrEqual(Math.min(CEIL.autoBind.settings, off[i].settings));
    });
  });
  test.each(Object.keys(PICKS))('"Yes, it\'s me", %s: the same answer and the same writes in order, under the ceilings', async (name) => {
    const off = await pickRow({}, name);
    const on = await pickRow({ fast: true }, name);
    console.log(`bindPick ${name}: OFF ${off.rows.map((x) => `${x.waves}/${x.dbWaves}db/${x.n}`).join(' ')} → ON ${on.rows.map((x) => `${x.waves}/${x.dbWaves}db/${x.n}`).join(' ')}`);
    expect(on.rows.map((x) => x.out)).toEqual(off.rows.map((x) => x.out));
    expect(on.writes).toEqual(off.writes);
    on.rows.forEach((x, i) => {
      expect(x.waves).toBeLessThanOrEqual(Math.min(CEIL.bindPick.waves, off.rows[i].waves));
      expect(x.dbWaves).toBeLessThanOrEqual(CEIL.bindPick.db);
      expect(x.settings).toBeLessThanOrEqual(Math.min(CEIL.bindPick.settings, off.rows[i].settings));
      expect(x.personaReads).toBeLessThanOrEqual(CEIL.bindPick.persona);
    });
  });
  test('the chat child\'s "Yes, it\'s me" (a returning family\'s first tap) loses at least five database waves', async () => {
    const off = await pickRow({}, 'chat');
    const on = await pickRow({ fast: true }, 'chat');
    expect(off.rows[1].dbWaves - on.rows[1].dbWaves).toBeGreaterThanOrEqual(5);
  });
  test('the grade tap: two Redis waves, no database wave once the switches are warm, one settings read cold', async () => {
    const on = await gradeRow({ fast: true });
    on.forEach((x) => {
      expect(x.waves).toBeLessThanOrEqual(CEIL.grade.waves + (x.settings ? 1 : 0));
      expect(x.settings).toBeLessThanOrEqual(CEIL.grade.settings);
    });
    expect(on[1].dbWaves).toBe(CEIL.grade.db);
    expect(on.map((x) => x.out)).toEqual(BASE.grade.map((x) => x.out));
  });
});

describe('quiz_door_activity_once ON: the door counts the teacher tables in one round trip, with the same verdict', () => {
  test.each(Object.keys(DOOR_USERS))('%s: the one door\'s and the chat door\'s verdict are the OFF bytes', async (name) => {
    for (const which of ['role', 'classify']) {
      const off = await doorRow({}, name, which);
      const on = await doorRow({ once: true }, name, which);
      console.log(`door ${which} ${name}: OFF ${off.waves}/${off.dbWaves}db/${off.n} → ON ${on.waves}/${on.dbWaves}db/${on.n}`);
      expect(on.out).toEqual(off.out);
      expect(on.settings).toBe(off.settings);
      expect(on.waves).toBeLessThanOrEqual(off.waves);
    }
  });
  test('a new phone\'s door: six database waves fewer, on the one door and on the chat door', async () => {
    for (const which of ['role', 'classify']) {
      const off = await doorRow({}, 'fresh', which);
      const on = await doorRow({ once: true }, 'fresh', which);
      expect(off.dbWaves - on.dbWaves).toBeGreaterThanOrEqual(CEIL.doorDrop);
    }
  });

  const tables = ['quizzes', 'coaching_sessions', 'lesson_plans', 'student_lists', 'training_assessment_attempts', 'assessment_requests', 'class_teachers'];
  test.each([
    ['nothing', {}], ...tables.map((t) => [`a ${t} row`, { hit: t }]), ...tables.map((t) => [`a failed ${t} read`, { fail: t }]),
    ['a failed early read before a later hit', { fail: 'coaching_sessions', hit: 'assessment_requests' }],
    ['an early hit before a later failed read', { hit: 'coaching_sessions', fail: 'assessment_requests' }],
  ])('the door\'s teacher check, %s → the same verdict ON as OFF', async (_label, { hit, fail }) => {
    const verdict = async (once) => {
      boot({ once });
      await require('../../../shared/services/first-touch/one-door.flags').flags();
      const supabase = require('../../../shared/config/supabase');
      const from = supabase.from;
      supabase.from = (t) => {
        const b = from(t);
        if (t === fail) b.then = (res, rej) => Promise.resolve({ data: null, count: null, error: { message: 'boom' } }).then(res, rej);
        return b;
      };
      if (hit) fake.db[hit].push(hit === 'quizzes' ? { teacher_id: 'u-x' } : hit === 'class_teachers' ? { teacher_user_id: 'u-x', is_active: true } : { user_id: 'u-x', gamma_url: 'g' });
      // the door's two counts: every table together (switch ON) and today's serial count (OFF)
      const Signs = require('../../../shared/services/student-ingress-identity');
      const r = await measure(() => (once ? Signs.activityAll('u-x') : Signs.activity('u-x')));
      return r;
    };
    const off = await verdict(undefined);
    const on = await verdict(true);
    expect(on.out).toEqual(off.out);
    // one round trip is the floor (a failed read here answers at once; on the wire it costs its round trip too)
    expect(on.dbWaves).toBeLessThanOrEqual(Math.max(1, off.dbWaves));
  });
});

describe('the join\'s one switch read fills every switch group it carries', () => {
  test('the join\'s one read fills the identity and hub switches: a hub switch and the door\'s switch are seen with no read of their own', async () => {
    boot({ fast: true, once: true });
    await Join.flags();
    const r = await measure(async () => ({
      hub: await require('../../../shared/services/quiz/web-quiz-hub-flags').flags(),
      id: await require('../../../shared/services/quiz/web-quiz-identity-flags').flags(),
      home: await require('../../../shared/services/quiz/web-quiz-home-flags').flags(),
    }));
    expect(r.n).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ hub: { hub: true, eventsV2: true }, id: { canon: true, phoneBind: true, firstDoor: true },
      home: { home: true, stories: false, list: false } });
  });
  test('the home switches\' fill throws when the read did not ask for one of its keys (a hand-written list), and an absent row is off', async () => {
    boot({ fast: true });
    const Home = require('../../../shared/services/quiz/web-quiz-home-flags');
    expect(() => Home.prime([{ key: 'web_quiz_home_v3', value: true }], NOW, Home.KEYS.filter((k) => k !== 'web_quiz_stories'))).toThrow('web_quiz_stories');
    Home.prime([{ key: 'web_quiz_home_v3', value: true }], NOW, Home.KEYS);
    const r = await measure(() => Home.flags());
    expect(r.n).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ home: true, stories: false, column: false, shelf: false, list: false });
  });
  test('switch OFF: the join\'s read fills no home switch (the home reads its own, as today)', async () => {
    boot({});
    await Join.flags();
    const r = await measure(() => require('../../../shared/services/quiz/web-quiz-home-flags').flags());
    expect(r.seq).toEqual(['db.app_settings']);
  });
  test('a key the read asked for with no row in the database reads off, with no read of its own', async () => {
    boot({ fast: true });
    await Join.flags();
    const r = await measure(() => require('../../../shared/services/quiz/web-quiz-hub-flags').flags());
    expect(r.n).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ rungs: false, readalong: false });
  });
  test('a live cache is kept (the hub read its own switches 10 s ago); an expired one is replaced by the fill', async () => {
    boot({ fast: true });
    const Hub = require('../../../shared/services/quiz/web-quiz-hub-flags');
    await Hub.flags();
    jest.setSystemTime(NOW + 10 * 1000);
    fake.db.app_settings.find((r) => r.key === 'web_quiz_events_v2').value = false;
    await Join.flags();
    expect((await Hub.flags()).eventsV2).toBe(true);
    jest.setSystemTime(NOW + 41 * 1000);
    Join._resetCache();
    await Join.flags();
    const r = await measure(() => Hub.flags());
    expect(r.n).toBe(0);
    expect(JSON.parse(r.out).eventsV2).toBe(false);
  });
});
