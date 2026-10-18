'use strict';
/**
 * The class rosters the hub uses kept fresh (app_settings web_quiz_hub_roster_warm, default off; only with
 * web_quiz_hub_fanout, whose keeper ticks it). The identity lookup reads each class's roster through a 30 s cache, so a
 * child of a class list coming back after 30 s waits for that roster again (two reads, one after the other). On: the
 * classes the lookup used in the last 5 minutes (at most 100) are read again by the keeper shortly before their cache
 * runs out, so the next child of that class finds it fresh. The answer is the same, byte for byte; only the wait goes.
 * The keeper's own timer is held here and its ticks are run by hand at fixed times, so every run is the same.
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
function tables({ fast, loose = false, home = false, stories = false, fanout = false, merged = false, extra = [], otherGrade = false, fresh = false, roster = false }) {
  const t = {
    app_settings: [...ON_KEYS.map((key) => ({ key, value: 'true' })), ...(fast ? [{ key: 'web_quiz_fast', value: true }] : []),
      ...(home ? [{ key: 'web_quiz_home_v3', value: true }] : []), ...(stories ? [{ key: 'web_quiz_stories', value: true }] : []),
      ...(fanout === true ? [{ key: 'web_quiz_hub_fanout', value: true }] : fanout ? [{ key: 'web_quiz_hub_fanout', value: fanout }] : []),
      ...extra.map((key) => ({ key, value: true })),
      ...(roster === true ? [{ key: 'web_quiz_hub_roster_warm', value: true }] : roster ? [{ key: 'web_quiz_hub_roster_warm', value: roster }] : [])],
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
  // otherGrade: the last video the child finished is a grade-4 video (the recommendations follow it, not the child's grade 3)
  if (otherGrade) {
    t.student_videos.find((v) => v.id === V(2)).grade = '4';
    t.student_videos.push({ ...video(9, 'Maths', 'Fractions', 'Fifths'), grade: '4' }, { ...video(10, 'English', 'Nouns', 'Places'), grade: '4' });
    t.quizzes.push(...[9, 10].map((n) => ({ id: `q-v${n}`, video_id: V(n), quiz_source: 'video', status: 'ready', topic: `V${n}`, subject: 'x', grade: '4' })));
  }
  // fresh: a child with no quiz yet (no history: no last video, no teacher)
  if (fresh) { t.quiz_sessions = []; t.quiz_answers = []; }
  if (loose) {
    t.students[0].list_id = null;
    t.class_enrollments = [];
    t.classes = [];
    t.quiz_share_codes.find((c) => c.id === 'sc-new').class_id = null;
  }
  return t;
}

// ── the boundary: every read takes READ_MS and gets its wave ─────────────────────────────────────────
// A read of a child's OWN rows: students / class_enrollments / student_lists by the child's id or list id. The class
// roster's reads (by class, for the identity lookup; their own 30 s cache) are the class's rows, not counted here.
const OWN = new Set(['students', 'class_enrollments', 'student_lists']);
let reads = [];
let doneMax = 0;
let failCols = null; // a select whose columns are these answers { error } (a refused read)
let gen = 0; // each boot's reads only: a timer left by an earlier boot (the keeper) reads its own, uncounted
function seed(opts) {
  const fake = makeFake(tables(opts));
  const mine = ++gen;
  const from = (t) => {
    const b = fake.from(t);
    const then = b.then;
    const select = b.select;
    let cols = '';
    b.select = (c, o) => { cols = String(c || ''); return select.call(b, c, o); };
    b.then = (res, rej) => {
      const roster = /loadClassRoster/.test(new Error().stack);
      const rec = { t, wave: doneMax + 1, own: OWN.has(t) && !roster };
      if (mine === gen) reads.push(rec);
      return new Promise((r) => setTimeout(r, READ_MS))
        .then(() => { if (mine === gen) doneMax = Math.max(doneMax, rec.wave); return failCols && failCols.t === t && cols === failCols.cols ? { data: null, error: { message: 'refused' } } : then.call(b, (x) => x); })
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
  try { require('../../../shared/services/quiz/web-quiz-hub-warm')._stop(); } catch (_) { /* not loaded */ }
  jest.resetModules();
  jest.setSystemTime(NOW);
  seed(opts);
  Hub = require('../../../shared/services/quiz/web-quiz-hub');
  T = require('../../../shared/services/quiz/web-quiz-token');
}

/** One hub request: the payload as the page gets it, its hub_open line, its waves, its reads per table and its own-row reads. */
async function measure(token, opts) {
  await settle();
  reads = [];
  doneMax = 0;
  const { logEvent } = require('../../../shared/utils/structured-logger');
  logEvent.mockClear();
  const out = JSON.stringify(await Hub.hub(token, opts));
  const waves = doneMax;
  const perTable = {};
  const own = {};
  reads.forEach((r) => { perTable[r.t] = (perTable[r.t] || 0) + 1; if (r.own) own[r.t] = (own[r.t] || 0) + 1; });
  const open = logEvent.mock.calls.filter(([name]) => name === 'web_quiz.hub_open').map(([, f]) => f);
  await settle();
  return { out, open: JSON.stringify(open), waves, perTable, own, rs: reads.length };
}

const SAVED = { ...process.env };
// The keeper's interval never fires on its own here: its ticks run by hand (ticks()).
let realSetInterval;
beforeAll(() => {
  realSetInterval = global.setInterval;
  global.setInterval = (fn, ms) => (ms === require('../../../shared/services/quiz/web-quiz-hub-warm').TICK_MS ? { unref() {}, stub: true } : realSetInterval(fn, ms));
  jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => {
  global.setInterval = realSetInterval;
  jest.useRealTimers();
  process.env = SAVED;
});
beforeEach(() => {
  failCols = null;
  process.env = { ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'hub-roster-secret', PORTAL_URL: 'https://portal.example.test', WQ_TOMB_SALT: 'hub-roster-salt' };
  delete process.env.WEB_QUIZ_BASE_URL;
});
afterEach(() => { try { require('../../../shared/services/quiz/web-quiz-hub-warm')._stop(); } catch (_) { /* not loaded */ } });

/** Warm (the second request, 2 s after the first: a new visit) and stale (31 s later) for one fixture and token. */
/** The keeper's ticks between two visits, at these seconds after NOW (each tick's reads counted apart, as `kept`). */
async function ticks(at) {
  const Warm = require('../../../shared/services/quiz/web-quiz-hub-warm');
  const before = reads.length;
  for (const sec of at) {
    jest.setSystemTime(NOW + sec * 1000);
    await Warm.tick();
    await settle();
  }
  return reads.slice(before);
}
async function warmAndStale(opts, ids = [KID], at = [28, 31]) {
  boot(opts);
  const tok = T.signHub(ids);
  const o = { device: DEVICE };
  await measure(tok, o);
  jest.setSystemTime(NOW + 2 * 1000);
  const warm = await measure(tok, o);
  reads = [];
  const kept = await ticks(at);
  jest.setSystemTime(NOW + 33 * 1000);
  const stale = await measure(tok, o);
  stale.kept = kept;
  return { warm, stale };
}

const FAN = ['web_quiz_hub_fanout'];
const ALL = ['web_quiz_hub_fanout', 'web_quiz_hub_waves2', 'web_quiz_hub_child_memo'];
const SETS = [['fanout', FAN], ['fanout + waves2 + the rows once', ALL]];
const FIXTURES = [['a child on a class list', {}], ['a child on a class list, home + stories on', { home: true, stories: true }]];

describe.each(FIXTURES)('the class roster kept fresh: %s', (_name, fx) => {
  test.each(SETS)('%s: the same answer and hub_open line; back after 33 s, two waves fewer (the roster is fresh)', async (_set, extra) => {
    const off = await warmAndStale({ fast: true, ...fx, extra });
    const on = await warmAndStale({ fast: true, ...fx, extra, roster: true });
    expect(on.warm.out).toBe(off.warm.out);
    expect(on.stale.out).toBe(off.stale.out);
    expect(on.warm.open).toBe(off.warm.open);
    expect(on.stale.open).toBe(off.stale.open);
    console.log(`hub waves (${_name}, ${_set}): off ${off.warm.waves} warm / ${off.stale.waves} back after 33 s; on ${on.warm.waves} / ${on.stale.waves}; keeper reads off ${off.stale.kept.length} on ${on.stale.kept.length}`);
    expect(on.warm.waves).toBe(off.warm.waves);
    expect(on.stale.waves).toBeLessThanOrEqual(off.stale.waves - 2);
    // the keeper's own reads: the roster's (enrolments + lists, then students + strays), once
    const extraKept = on.stale.kept.length - off.stale.kept.length;
    expect(extraKept).toBeGreaterThan(0);
    expect(extraKept).toBeLessThanOrEqual(4);
  });
});

describe('a loose child (no class)', () => {
  test.each(SETS)('%s: nothing changes, and the keeper reads no roster', async (_set, extra) => {
    const off = await warmAndStale({ fast: true, loose: true, extra });
    const on = await warmAndStale({ fast: true, loose: true, extra, roster: true });
    expect(on.stale.out).toBe(off.stale.out);
    expect({ waves: on.stale.waves, kept: on.stale.kept.length }).toEqual({ waves: off.stale.waves, kept: off.stale.kept.length });
  });
});

describe('the keeper stops asking for a class nobody uses', () => {
  test('a class not used by the lookup for 5 minutes is read no more', async () => {
    const run = await warmAndStale({ fast: true, extra: FAN, roster: true });
    expect(run.stale.kept.some((r) => r.t === 'student_lists')).toBe(true);
    reads = [];
    // the hub is asked nothing for 6 minutes (another child keeps the keeper alive: its own switches only)
    const kept = await ticks([33 + 6 * 60 - 2, 33 + 6 * 60]);
    expect(kept.filter((r) => r.t === 'class_enrollments' || r.t === 'student_lists')).toEqual([]);
  });

  test('at most 100 classes are kept', () => {
    jest.resetModules();
    seed({ fast: true, extra: FAN, roster: true });
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    Flags.prime([...FAN, 'web_quiz_hub_roster_warm'].map((key) => ({ key, value: true })));
    const Roster = require('../../../shared/services/quiz/web-quiz-identity-roster');
    for (let i = 0; i < 130; i += 1) Roster.noteClass(`c-${i}`);
    expect(Roster._keptClasses()).toHaveLength(100);
    expect(Roster._keptClasses()[99]).toBe('c-129');
  });
});

describe('off is today', () => {
  test.each([['the string true', 'true'], ['1', 1], ['an object', { on: true }]])('%s: not on; the same reads, waves, keeper reads and answer as no row', async (_n, value) => {
    for (const extra of [FAN, ALL]) {
      const none = await warmAndStale({ fast: true, extra });
      const odd = await warmAndStale({ fast: true, extra, roster: value });
      expect(odd.stale.out).toBe(none.stale.out);
      expect({ warm: odd.warm.perTable, stale: odd.stale.perTable, kept: odd.stale.kept.length }).toEqual({ warm: none.warm.perTable, stale: none.stale.perTable, kept: none.stale.kept.length });
      expect({ warm: odd.warm.waves, stale: odd.stale.waves }).toEqual({ warm: none.warm.waves, stale: none.stale.waves });
    }
  });
  test('on without the reads together (fanout off: no keeper): today, read for read', async () => {
    const none = await warmAndStale({ fast: true });
    const on = await warmAndStale({ fast: true, roster: true });
    expect(on.stale.out).toBe(none.stale.out);
    expect({ warm: on.warm.perTable, stale: on.stale.perTable }).toEqual({ warm: none.warm.perTable, stale: none.stale.perTable });
  });
});
