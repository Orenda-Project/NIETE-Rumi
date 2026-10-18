'use strict';
/**
 * The hub's reads started together (app_settings web_quiz_hub_fanout, default off). On: the reads of the hub's answer
 * that do not need each other's answers start at once, and the hub's switch caches are kept warm while children use the
 * hub, so a child coming back after the caches' 30 s finds them fresh. The answer is the same, byte for byte, and its
 * hub_open line too; only the waits go. Every read takes READ_MS at the boundary (Supabase, faked) and is given a WAVE,
 * 1 + the highest wave of the reads already finished when it started; the page waits for the highest wave (the same
 * harness as web-quiz-hub-home-waves.test.js).
 *
 * Supabase, Redis and the loggers are the boundaries; every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable() { return true; },
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');

const READ_MS = 8;
// A fixed clock (Wednesday 14 Oct 2026, 11:00 PKT): the payload's dates and tokens are the same on every run.
const NOW = Date.UTC(2026, 9, 14, 6, 0, 0);
const KID = '44444444-4444-4444-8444-000000000001';
const SIB = '44444444-4444-4444-8444-000000000002';
const OLD = '44444444-4444-4444-8444-000000000003';
const PEER = (n) => `44444444-4444-4444-8444-0000000001${String(n).padStart(2, '0')}`;
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const CLASS = '66666666-6666-4666-8666-000000000001';
const V = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-0000000000${String(n).padStart(2, '0')}`;
const VQ = (n) => `bbbbbbbb-bbbb-4bbb-8bbb-0000000000${String(n).padStart(2, '0')}`;
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const future = new Date(NOW + 10 * 86400000).toISOString();
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';

const ON_KEYS = ['web_quiz_hub', 'web_quiz_challenge', 'web_quiz_library', 'web_quiz_child_quiz_home', 'web_quiz_home_button',
  'web_quiz_events_v2', 'web_quiz_challenge_v2', 'web_quiz_challenge_story', 'web_quiz_challenge_book', 'web_quiz_class_wall',
  'web_quiz_install_prompt', 'web_quiz_hub_challenge_first', 'web_quiz_identity_canon', 'web_quiz_phone_bind',
  'web_quiz_challenge_record', 'web_quiz_challenge_missing', 'web_quiz_challenge_listen', 'web_quiz_ur_polish'];

function code(id, c, quizId, extra = {}) {
  return { id, code: c, quiz_id: quizId, active: true, expires_at: future, topic: `Topic ${c}`, language: 'en', class_id: null,
    teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(48), ...extra };
}
function sess(id, sc, quizId, status, c, t, at) {
  return { id, share_code_id: sc, quiz_id: quizId, student_id: KID, status, correct_answers: c, total_questions_answered: t,
    mastery_percentage: t ? Math.round((100 * c) / t) : 0, completed_at: status === 'completed' ? at : null, created_at: at, student_class: '3' };
}
function video(n, subject, chapter, title) {
  return { id: V(n), grade: '3', subject, clean_chapter: chapter, clean_title: title, migration_status: 'done', superseded_by: null, r2_url: null };
}
const run = (over) => ({ id: `r-${Math.random().toString(36).slice(2, 10)}`, student_id: KID, canonical_id: KID, exercise: 'read', status: 'scored',
  mode: 'practice', record: false, period_id: '2026-10', passage_id: null, item_set_id: null, class_id: null, exposure_no: 1, via: 'hub',
  created_at: ago(30), scored_at: ago(30), ...over });
const passage = (id, kind, band, h) => ({ passage_id: id, twin_of: null, lang: 'en', band, kind, pool: 'practice', status: 'reviewed',
  released_at: new Date(NOW - h * 3600000).toISOString(), title_en: `Title ${id}`, title_ur: null });

// loose: the usual quiz child on prod (no class list, no enrolment; their teacher known from the links they played).
function tables({ fast, loose = false, home = false, stories = false, fanout = false, merged = false }) {
  const t = {
    app_settings: [...ON_KEYS.map((key) => ({ key, value: 'true' })), ...(fast ? [{ key: 'web_quiz_fast', value: true }] : []),
      ...(home ? [{ key: 'web_quiz_home_v3', value: true }] : []), ...(stories ? [{ key: 'web_quiz_stories', value: true }] : []),
      ...(fanout === true ? [{ key: 'web_quiz_hub_fanout', value: true }] : fanout ? [{ key: 'web_quiz_hub_fanout', value: fanout }] : [])],
    students: [
      { id: KID, student_name: 'Sana Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, merged_into: null, status: null, created_at: ago(500) },
      { id: SIB, student_name: 'Bilal Testwala', student_name_urdu: null, self_reported_class: '5', list_id: null, is_active: true, merged_into: null, status: null, created_at: ago(400) },
    ],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    class_enrollments: [{ id: 'enr-1', student_id: KID, class_id: CLASS, is_active: true }],
    classes: [{ id: CLASS, grade_code: 'grade_3', section: 'A', is_active: true }],
    quizzes: [
      { id: 'q-maths', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: V(2), quiz_source: 'video', status: 'ready' },
      { id: 'q-eng', topic: 'Nouns', subject: 'english', language: 'en', grade: '3', video_id: null },
      { id: 'q-sci', topic: 'Plants', subject: 'science', language: 'en', grade: '3', video_id: null },
      { id: 'q-new', topic: 'Shapes', subject: 'maths', language: 'en', grade: '3', video_id: null },
      ...[1, 3, 4, 5, 6, 7, 8].map((n) => ({ id: VQ(n), video_id: V(n), quiz_source: 'video', status: 'ready', topic: `V${n}`, subject: 'x', grade: '3' })),
    ],
    quiz_share_codes: [
      code('sc-maths', 'MATH01', 'q-maths', { created_at: ago(30) }),
      code('sc-eng', 'ENGL01', 'q-eng', { created_at: ago(60) }),
      code('sc-sci', 'SCIE01', 'q-sci', { created_at: ago(90), active: false }),
      code('sc-new', 'NEWQ01', 'q-new', { created_at: ago(5), class_id: CLASS }),
    ],
    quiz_sessions: [
      sess('s1', 'sc-maths', 'q-maths', 'completed', 4, 10, ago(30)),
      sess('s2', 'sc-maths', 'q-maths', 'completed', 8, 10, ago(20)),
      sess('s3', 'sc-eng', 'q-eng', 'completed', 6, 8, ago(50)),
      sess('s4', 'sc-sci', 'q-sci', 'completed', 5, 5, ago(80)),
      sess('s5', 'sc-eng', 'q-eng', 'in_progress', 0, 0, ago(2)),
      { ...sess('s6', 'sc-maths', VQ(3), 'completed', 3, 3, ago(70)), share_code_id: null },
    ],
    quiz_answers: [{ id: 'a1', session_id: 's5' }, { id: 'a2', session_id: 's5' }, { id: 'a3', session_id: 's5' }],
    student_videos: [
      video(1, 'Maths', 'Addition', 'Adding tens'), video(2, 'Maths', 'Fractions', 'Halves'), video(3, 'Maths', 'Fractions', 'Quarters'),
      video(4, 'Maths', 'Measurement', 'Length'), video(5, 'English', 'Nouns', 'Naming words'), video(6, 'English', 'Verbs', 'Doing words'),
      video(7, 'Science', 'Plants', 'Leaves'), video(8, 'Maths', 'Fractions', 'Thirds'),
    ],
    web_quiz_challenge_runs: [
      run({ exercise: 'read', mode: 'check', record: true, status: 'scored', passage_id: 'en.read.1.story01', created_at: ago(26) }),
      run({ exercise: 'listen', mode: 'practice', status: 'served', passage_id: 'en.listen.1.story01', created_at: ago(25) }),
      // The class's own runs (the class lights): five other children of the class this term.
      ...[1, 2, 3, 4, 5].map((n) => run({ student_id: PEER(n), canonical_id: PEER(n), class_id: CLASS, passage_id: 'en.read.1.story02', created_at: ago(10 + n) })),
    ],
    child_rungs: [{ canonical_id: KID, ladder: 'reading', rung: 3, period_id: '2026-10', set_at: ago(26), row_id: null }],
    child_identity: [],
    challenge_passages: [
      passage('en.read.1.story01', 'read', 1, 24 * 9),
      passage('en.read.1.story02', 'read', 1, 24 * 2),
      passage('en.listen.1.story01', 'listen', 1, 24 * 3),
      passage('en.read.2.story01', 'read', 2, 24 * 1),
      passage('en.read.1.story03', 'read', 1, -24 * 2),
    ],
  };
  // merged: the link names an older record of this child, merged into KID (the identity lookup gives another id)
  if (merged) t.students.push({ id: OLD, student_name: 'Sana Testwala', student_name_urdu: null, self_reported_class: '3', list_id: null, is_active: true, merged_into: KID, status: 'merged', created_at: ago(900) });
  if (loose) {
    t.students[0].list_id = null;
    t.class_enrollments = [];
    t.classes = [];
    t.quiz_share_codes.find((c) => c.id === 'sc-new').class_id = null;
  }
  return t;
}

// ── the boundary: every read takes READ_MS and gets its wave ─────────────────────────────────────────
let reads = [];
let doneMax = 0;
function seed(opts) {
  const fake = makeFake(tables(opts));
  const from = (t) => {
    const b = fake.from(t);
    const then = b.then;
    b.then = (res, rej) => {
      const rec = { t, wave: doneMax + 1 };
      reads.push(rec);
      return new Promise((r) => setTimeout(r, READ_MS))
        .then(() => { doneMax = Math.max(doneMax, rec.wave); return then.call(b, (x) => x); })
        .then(res, rej);
    };
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}
const settle = () => new Promise((r) => setTimeout(r, 12 * READ_MS));

let Hub;
let T;
function boot(opts) {
  jest.resetModules();
  jest.setSystemTime(NOW);
  seed(opts);
  Hub = require('../../../shared/services/quiz/web-quiz-hub');
  T = require('../../../shared/services/quiz/web-quiz-token');
}

/** One hub request: the payload as the page gets it, its hub_open line, its waves and its reads per table. */
async function measure(token, opts) {
  await settle();
  reads = [];
  doneMax = 0;
  const { logEvent } = require('../../../shared/utils/structured-logger');
  logEvent.mockClear();
  const out = JSON.stringify(await Hub.hub(token, opts));
  const waves = doneMax;
  const perTable = {};
  reads.forEach((r) => { perTable[r.t] = (perTable[r.t] || 0) + 1; });
  const open = logEvent.mock.calls.filter(([name]) => name === 'web_quiz.hub_open').map(([, f]) => f);
  await settle();
  return { out, open: JSON.stringify(open), waves, perTable };
}

const SAVED = { ...process.env };
beforeAll(() => {
  // The clock is pinned at NOW (the week's day-dots and the 30 s caches read it); the timers the reads wait on stay real.
  jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => {
  jest.useRealTimers();
  process.env = SAVED;
});
beforeEach(() => {
  process.env = { ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'hub-waves-secret', PORTAL_URL: 'https://portal.example.test', WQ_TOMB_SALT: 'hub-waves-salt' };
  delete process.env.WEB_QUIZ_BASE_URL;
});

const tokenOne = () => T.signHub([KID]);

/** Warm (the second request) and stale (31 s later) waves and payloads for one fixture. */
async function warmAndStale(opts, { keepWarm = false } = {}) {
  boot(opts);
  const tok = tokenOne();
  await measure(tok, { device: DEVICE });
  const warm = await measure(tok, { device: DEVICE });
  jest.setSystemTime(NOW + 31 * 1000);
  // the keeper's tick (every second in a live process) runs once between the visits
  if (keepWarm) { await require('../../../shared/services/quiz/web-quiz-hub-warm').tick(); await settle(); }
  const stale = await measure(tok, { device: DEVICE });
  return { warm, stale };
}
afterEach(() => { try { require('../../../shared/services/quiz/web-quiz-hub-warm')._stop(); } catch (_) { /* not loaded */ } });

const FIXTURES = [['a child on a class list', { loose: false }], ['a loose child', { loose: true }],
  ['a child on a class list, home + stories on', { loose: false, home: true, stories: true }], ['a loose child, home + stories on', { loose: true, home: true, stories: true }]];

describe.each(FIXTURES)('the hub, reads together: %s', (_name, fx) => {
  test('on: the answer and its hub_open line are byte for byte the same as off, warm and stale', async () => {
    const off = await warmAndStale({ fast: true, ...fx });
    const on = await warmAndStale({ fast: true, ...fx, fanout: true });
    expect(on.warm.out).toBe(off.warm.out);
    expect(on.stale.out).toBe(off.stale.out);
    expect(on.warm.open).toBe(off.warm.open);
    expect(on.stale.open).toBe(off.stale.open);
    // no table is read more often than today
    for (const [t, n] of Object.entries(on.warm.perTable)) expect([t, n]).toEqual([t, Math.min(n, off.warm.perTable[t] || 0)]);
  });

  test('on: far fewer waves warm (at most half of off), and fewer stale', async () => {
    const off = await warmAndStale({ fast: true, ...fx });
    const on = await warmAndStale({ fast: true, ...fx, fanout: true });
    console.log(`hub waves (${_name}): off ${off.warm.waves} warm / ${off.stale.waves} stale; together ${on.warm.waves} / ${on.stale.waves}`);
    expect(on.warm.waves).toBeLessThanOrEqual(Math.floor(off.warm.waves / 2));
    expect(on.stale.waves).toBeLessThan(off.stale.waves);
  });

  test('on: the identity lookup is made once per visit (the pick record shares the hub\'s)', async () => {
    const off = await warmAndStale({ fast: true, ...fx });
    const on = await warmAndStale({ fast: true, ...fx, fanout: true });
    expect(on.warm.perTable.class_enrollments).toBeLessThanOrEqual(off.warm.perTable.class_enrollments - 1);
    expect(on.stale.perTable.class_enrollments).toBeLessThanOrEqual(off.stale.perTable.class_enrollments - 1);
  });

  test('on: the children\'s rows and lists ride beside the identity lookup (warm waves at most 40% of off)', async () => {
    const off = await warmAndStale({ fast: true, ...fx });
    const on = await warmAndStale({ fast: true, ...fx, fanout: true });
    expect(on.warm.waves).toBeLessThanOrEqual(Math.floor(off.warm.waves * 0.4));
  });

  // The class roster's own 30 s cache is per class (web-quiz-identity-roster.js), so the keeper does not hold it: a
  // child on a class list pays its 2 reads again after 31 s; a loose child has none.
  test('on, with the keeper ticking: a child back after 31 s waits no longer than a warm visit (+ the class roster)', async () => {
    const on = await warmAndStale({ fast: true, ...fx, fanout: true }, { keepWarm: true });
    console.log(`hub waves kept warm (${_name}): ${on.warm.waves} warm / ${on.stale.waves} after 31 s`);
    expect(on.stale.waves).toBeLessThanOrEqual(on.warm.waves + (fx.loose ? 0 : 2));
  });
});

describe('off is today', () => {
  test.each([['the string true', 'true'], ['1', 1], ['an object', { on: true }]])('%s: not on; the same waves and answer as no row', async (_n, value) => {
    const none = await warmAndStale({ fast: true });
    const odd = await warmAndStale({ fast: true, fanout: value });
    expect(odd.warm.out).toBe(none.warm.out);
    expect({ warm: odd.warm.waves, stale: odd.stale.waves }).toEqual({ warm: none.warm.waves, stale: none.stale.waves });
  });

  test('the keeper never starts while off, and stops on its own once the switch goes off', async () => {
    boot({ fast: true });
    const Warm = require('../../../shared/services/quiz/web-quiz-hub-warm');
    await measure(tokenOne(), { device: DEVICE });
    expect(Warm._running()).toBe(false);
    boot({ fast: true, fanout: true });
    const W2 = require('../../../shared/services/quiz/web-quiz-hub-warm');
    await measure(tokenOne(), { device: DEVICE });
    expect(W2._running()).toBe(true);
    // the switch goes off; the next tick past the cache time reads it and stops
    seed({ fast: true });
    jest.setSystemTime(NOW + 31 * 1000);
    await W2.tick();
    expect(W2._running()).toBe(false);
  });
});

describe('the identity lookup gives another id (a merged record on the link)', () => {
  test('on: the children\'s rows are read again for that id; the answer and hub_open line are the same as off', async () => {
    const run2 = async (fanout) => {
      boot({ fast: true, merged: true, fanout });
      const tok = T.signHub([OLD]);
      await measure(tok, { device: DEVICE });
      return measure(tok, { device: DEVICE });
    };
    const off = await run2(false);
    const on = await run2(true);
    expect(on.out).toBe(off.out);
    expect(on.open).toBe(off.open);
    expect(JSON.parse(on.out).kids.length).toBe(1);
    // the early read for the link's own id is the only extra one
    expect(on.perTable.students).toBeLessThanOrEqual(off.perTable.students + 1);
    console.log('merged students reads', off.perTable.students, on.perTable.students, JSON.parse(on.out).kid);
  });
});
