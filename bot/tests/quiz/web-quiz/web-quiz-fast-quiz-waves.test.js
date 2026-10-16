'use strict';
/**
 * Fast first page (web_quiz_fast): how many database round trips a child waits for, one after another, before the quiz
 * page answers. Supabase is the boundary: every read takes READ_MS and is timed. Every first-party module runs for real.
 *
 *   - Which class (identity v2): the code's class rides on the code read, the quiz row is getQuiz's own, and the
 *     teacher's classes are read beside it, so the class is known 2 round trips after the code, not 5.
 *   - A 30 s setting or roster that has gone stale is answered from what was read last and refreshed behind the page.
 *   - The payload is byte for byte what the switch-on page sent before this change (golden), for an English quiz with
 *     a known class, an Urdu quiz bound through its list, a code with no class, a quiz handed out by a teacher who did
 *     not make it (it resolves through the quiz's own list, as today) and a friend's challenge. Switch off: today's payload and today's
 *     reads, in today's order (golden).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { makeFake } = require('./fake-supabase');
const F = require('./web-quiz-identity-fixture');

const GOLDEN = path.join(__dirname, 'web-quiz-fast-quiz-waves.golden.json');
const READ_MS = 40;
const SENDER = '11111111-1111-4111-8111-11111111111b';
const SC_S = '33333333-3333-4333-8333-3333333333b1';
const CLS_C = 'c0000000-0000-4000-8000-00000000000c';
const LIST_C = 'a0000000-0000-4000-8000-00000000000c';

// ─── the school ─────────────────────────────────────────────────────────────

// The wave ceiling's case: every child-facing switch the quiz page reads, on (the ceiling test checks this list is complete).
const CEILING_KEYS = ['web_quiz_back_nav', 'web_quiz_challenge', 'web_quiz_challenge_rungs', 'web_quiz_challenge_v2', 'web_quiz_child_quiz_home',
  'web_quiz_events_v2', 'web_quiz_home_button', 'web_quiz_hub', 'web_quiz_hub_door', 'web_quiz_invite_ask', 'web_quiz_library',
  'web_quiz_link_home', 'web_quiz_rich_telemetry', 'web_quiz_ur_polish'];
// Keys the page reads that are not on/off switches of the child's page (web_quiz_identity is 'v2' in the fixture).
const NOT_SWITCHES = ['web_quiz_fast', 'web_quiz_brand', 'web_quiz_db_deadline', 'web_quiz_identity'];

function school(scn, { fast, every = false }) {
  const db = F.db({ codeClass: scn === 'en_class' || scn === 'invite' ? F.CLS_A : null });
  db.app_settings.push({ key: 'web_quiz_fast', value: fast });
  if (every) CEILING_KEYS.forEach((key) => db.app_settings.push({ key, value: 'true' }));
  db.app_settings.push({ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_link_home', value: true });
  db.quiz_sessions.push(F.done('s1', F.kid(1), 'Ayesha Testwala', 4, 2, { student_class: '4-A', completed_at: new Date().toISOString() }));
  if (scn === 'ur_list') {
    db.quizzes[0].language = 'ur';
    db.quizzes[0].list_id = F.LIST_A;
    db.quiz_share_codes[0].language = 'ur';
  }
  if (scn.startsWith('handed')) {
    db.quizzes[0].list_id = F.LIST_A;
    db.app_settings.push({ key: 'quiz_teacher_home', value: scn === 'handed_home_on' ? 'true' : 'false' });
    db.classes.push({ id: CLS_C, school_id: 's2', grade_code: 'grade_4', section: 'C', shift_code: 'morning', is_active: true, merged_into_class_id: null });
    db.class_teachers.push({ id: 'ct-c', class_id: CLS_C, teacher_user_id: SENDER, is_active: true, is_class_teacher: true });
    db.student_lists.push({ id: LIST_C, user_id: SENDER, class_name: 'Grade 4 - C', section: 'C', class_id: CLS_C, is_active: true });
    [1, 2].forEach((n) => {
      const id = `b0000000-0000-4000-8000-0000000000c${n}`;
      db.students.push({ id, student_name: `Chaand${n} Testwala`, father_name: null, roll_number: n, list_id: LIST_C, is_active: true, status: 'active', created_at: '2026-09-01T00:00:00Z' });
      db.class_enrollments.push({ id: `e-c${n}`, class_id: CLS_C, student_id: id, roll_number: n, is_active: true });
    });
    db.quiz_share_codes.push({ id: SC_S, code: 'SE12ND', quiz_id: F.QUIZ, teacher_user_id: SENDER, teacher_name: 'Sender Testwala', language: 'en',
      active: true, expires_at: new Date(Date.now() + 86400000).toISOString(), invited_by_student_id: null, parent_share_code_id: null,
      created_at: F.ago(3), class_id: null });
  }
  return db;
}
const CODE = { en_class: 'AB12CD', ur_list: 'AB12CD', no_class: 'AB12CD', handed_home_on: 'SE12ND', handed_home_off: 'SE12ND', invite: 'FR13ND' };
const SCENARIOS = Object.keys(CODE);

// Every read takes READ_MS; its start and end are recorded (a Supabase round trip, as the page pays it).
let reads = [];
const askedKeys = new Set(); // every app_settings key the code asked for
function install(db) {
  const fake = makeFake(db);
  const from = (t) => {
    const b = fake.from(t);
    const then = b.then;
    if (t === 'app_settings') {
      const eq = b.eq; const inn = b.in;
      b.eq = (c, v) => { if (c === 'key') askedKeys.add(v); return eq(c, v); };
      b.in = (c, vs) => { if (c === 'key') (vs || []).forEach((k) => askedKeys.add(k)); return inn(c, vs); };
    }
    b.then = (res, rej) => {
      // The caller (file:line in the services) rides on every read: the ceiling test prints the wave list.
      const at = (new Error().stack.split('\n').slice(2).find((l) => l.includes('services/quiz/') || l.includes('config/')) || '').trim().replace(/.*\/(\S+:\d+):\d+\)?$/, '$1');
      const r = { t, at, start: performance.now(), end: null };
      reads.push(r);
      return new Promise((ok) => setTimeout(ok, READ_MS)).then(() => { r.end = performance.now(); return then.call(b, (x) => x); }).then(res, rej);
    };
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
  return fake;
}

/** The serial depth of a set of reads: a read is one wave after the latest read that had finished when it started. */
function waveOf(rs) {
  const sorted = [...rs].sort((a, b) => a.start - b.start);
  const w = new Map();
  sorted.forEach((r) => {
    let d = 1;
    sorted.forEach((x) => { if (x !== r && x.end != null && x.end <= r.start + 0.5) d = Math.max(d, (w.get(x) || 1) + 1); });
    w.set(r, d);
  });
  return w;
}
const waves = (rs) => Math.max(0, ...waveOf(rs).values());
/** The reads of a page, one line per wave: `wave n: table (caller), ...`. */
function waveList(rs) {
  const w = waveOf(rs);
  const by = new Map();
  rs.forEach((r) => { const n = w.get(r); if (!by.has(n)) by.set(n, []); by.get(n).push(`${r.t} (${r.at || '?'})`); });
  return [...by.keys()].sort((x, y) => x - y).map((n) => `  wave ${n}: ${by.get(n).join(', ')}`).join('\n');
}

const SAVED = { ...process.env };
const realNow = Date.now;
let shift = 0;
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'fast-quiz-waves-secret' };
  shift = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => realNow() + shift);
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { process.env = SAVED; });

const settle = () => new Promise((r) => setTimeout(r, READ_MS * 8));
const stable = (out) => JSON.stringify(out);

/** A fresh process on one school: the first page (the switch is read), then a warm page, then one 31 s later. */
async function pages(scn, { fast, every = false }) {
  jest.resetModules();
  const WQ = require('../../../shared/services/quiz/web-quiz.service');
  install(school(scn, { fast, every }));
  const code = CODE[scn];
  const out = {};
  reads = [];
  out.first = stable(await WQ.getQuiz(code));
  out.firstReads = reads.map((r) => r.t);
  await settle();
  reads = [];
  let t0 = performance.now();
  out.warm = stable(await WQ.getQuiz(code));
  out.warmMs = performance.now() - t0;
  out.warmReads = reads.map((r) => r.t);
  out.warmSet = reads.filter((r) => r.end != null && r.end <= t0 + out.warmMs + 0.5);
  out.warmWaves = waves(out.warmSet);
  await settle();
  shift += 31 * 1000;
  reads = [];
  t0 = performance.now();
  out.stale = stable(await WQ.getQuiz(code));
  out.staleMs = performance.now() - t0;
  out.staleReads = reads.map((r) => r.t);
  out.staleSet = reads.filter((r) => r.end != null && r.end <= t0 + out.staleMs + 0.5);
  out.staleWaves = waves(out.staleSet);
  await settle();
  return out;
}
// The round trips the child waited for, one after another, on the clock (for the log; the machine's load moves it).
const depth = (ms) => Math.round(ms / READ_MS);
// The waves are counted over the reads that had finished when the page answered: every read the page waited for is
// among them, so the count is never below what the child waited for, and it does not move with the machine's load.
// A quiz handed out by a teacher who did not make it resolves (as today) to the author's class through the quiz's own
// list, and that class is not one of the sender's: its class row is one read after the list (4). A friend's challenge
// resolves through two code reads and reads the challenger's run after the page is built: not this change.
const LIMIT = { handed_home_on: 4, handed_home_off: 4, invite: null };

// The goldens: recorded once from the code before this change, then compared byte for byte.
let golden = null;
const loadGolden = () => {
  if (golden) return golden;
  golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : {};
  return golden;
};
function pin(key, value) {
  const g = loadGolden();
  if (!(key in g)) { g[key] = value; fs.writeFileSync(GOLDEN, `${JSON.stringify(g, null, 1)}\n`); }
  expect(value).toBe(g[key]);
}

describe.each(SCENARIOS)('%s', (scn) => {
  test('switch off: today\'s payload and today\'s reads, in today\'s order', async () => {
    const off = await pages(scn, { fast: false });
    expect(JSON.parse(off.warm).fast).toBeUndefined();
    pin(`${scn}:off:payload`, off.warm);
    pin(`${scn}:off:reads`, JSON.stringify(off.warmReads));
    pin(`${scn}:off:stale`, off.stale);
  });

  test('switch on: the payload is byte for byte the one before this change, warm and 31 s later', async () => {
    const on = await pages(scn, { fast: true });
    expect(JSON.parse(on.warm).fast).toBe(true);
    pin(`${scn}:on:payload`, on.warm);
    expect(on.stale).toBe(on.warm);
  });

  const limit = scn in LIMIT ? LIMIT[scn] : 3;
  (limit ? test : test.skip)(`switch on: the page waits for at most ${limit} round trips one after another, warm and 31 s later`, async () => {
    const on = await pages(scn, { fast: true });
    // eslint-disable-next-line no-console
    console.log(`${scn}: warm ${on.warmWaves} read waves (${depth(on.warmMs)} on the clock, ${Math.round(on.warmMs)} ms), stale ${on.staleWaves} (${depth(on.staleMs)}, ${Math.round(on.staleMs)} ms)`);
    expect(on.warmWaves).toBeLessThanOrEqual(limit);
    expect(on.staleWaves).toBeLessThanOrEqual(limit);
  });
});

// ─── the standing ceiling ───────────────────────────────────────────────────
// The quiz page's bot time is serial database round trips (about 250 ms each in production). This is the most it may
// cost with every child switch on and the fast page on: a change that adds a round trip to getQuiz goes red here.
// Read what you need beside what is already read (or hand down what getQuiz already has); raise a ceiling only with
// the reason in the change's description.
const QUIZ_CEILING = { warm: 4, stale: 4 };

describe('the quiz page\'s round-trip ceiling (every child switch on, fast page on)', () => {
  test(`at most ${QUIZ_CEILING.warm} waves warm, ${QUIZ_CEILING.stale} stale (31 s, every 30 s cache expired)`, async () => {
    askedKeys.clear();
    const on = await pages('en_class', { fast: true, every: true });
    expect(JSON.parse(on.warm).fast).toBe(true);
    expect(on.stale).toBe(on.warm);
    // eslint-disable-next-line no-console
    console.log(`quiz ceiling: warm ${on.warmWaves} (ceiling ${QUIZ_CEILING.warm}), stale ${on.staleWaves} (ceiling ${QUIZ_CEILING.stale})\n${waveList(on.warmSet)}`);
    const over = (what, got, max, set) => `${what}: ${got} serial round trips, the ceiling is ${max}. The waves (table, caller):\n${waveList(set)}`;
    if (on.warmWaves > QUIZ_CEILING.warm) throw new Error(over('getQuiz, warm', on.warmWaves, QUIZ_CEILING.warm, on.warmSet));
    if (on.staleWaves > QUIZ_CEILING.stale) throw new Error(over('getQuiz, stale', on.staleWaves, QUIZ_CEILING.stale, on.staleSet));
    // Every switch the page asked for is on in this case (a new switch joins CEILING_KEYS, so the ceiling sees its reads).
    const missing = [...askedKeys].filter((k) => !CEILING_KEYS.includes(k) && !NOT_SWITCHES.includes(k)).sort();
    expect(missing).toEqual([]);
  });
});

// ─── the class resolver on its own ──────────────────────────────────────────

describe('the class resolver handed what getQuiz already has', () => {
  const CASES = [
    ['en_class', F.TEACHER, F.SC], ['ur_list', F.TEACHER, F.SC], ['no_class', F.TEACHER, F.SC],
    ['handed_home_on', SENDER, SC_S], ['handed_home_off', SENDER, SC_S],
  ];
  // handed_*: the author's list names a class that is not the sender's (see LIMIT above): one read more.
  test.each(CASES)('%s: the same answer as reading everything itself, in 2 round trips after the code', async (scn, teacher, sc) => {
    jest.resetModules();
    const fake = install(school(scn, { fast: true }));
    const Identity = require('../../../shared/services/quiz/web-quiz-identity');
    const today = await Identity.resolveQuizClass({ teacherUserId: teacher, quizId: F.QUIZ, shareCodeId: sc });
    // getQuiz's own reads: the code (its class rides along) and the quiz row, started beside the resolver.
    const code = fake.db.quiz_share_codes.find((r) => r.id === sc);
    const row = fake.db.quizzes[0];
    await settle();
    reads = [];
    const t0 = performance.now();
    const quizRow = require('../../../shared/config/supabase').from('quizzes').select('grade, list_id, meta').eq('id', row.id).maybeSingle()
      .then(({ data }) => data);
    const handed = await Identity.resolveQuizClass({ teacherUserId: teacher, quizId: F.QUIZ, shareCodeId: sc, codeClassId: code.class_id || null, quizRow });
    const ms = performance.now() - t0;
    expect(JSON.stringify(handed)).toBe(JSON.stringify(today));
    expect(waves(reads.filter((r) => r.end != null && r.end <= t0 + ms + 0.5))).toBeLessThanOrEqual(scn.startsWith('handed') ? 3 : 2);
  });
});
