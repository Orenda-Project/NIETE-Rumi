'use strict';
/**
 * The kid hub's round-trip fixture, shared by the hub's wave tests (web-quiz-hub-waves.test.js, the ceiling and the
 * per-switch rows in web-quiz-hub-switch-waves.test.js).
 *
 * A fake Supabase where every read takes READ_MS and is given a WAVE: 1 + the highest wave of the reads already
 * finished when it started. The page waits for the highest wave. Each read also keeps its caller (file:line), so a
 * failing test can print the wave list.
 *
 * This file cannot hold the jest.mock calls (jest hoists them per test file). A test file that uses it must declare
 * the same boundary mocks BEFORE requiring this file, and run with fake timers (see `useClock`):
 *   - ../../../shared/config/supabase                         -> {}
 *   - ../../../shared/services/cache/railway-redis.service    -> an in-memory store (get/set/delete/setNX/isAvailable)
 *   - ../../../shared/services/whatsapp.service               -> { sendMessage }
 *   - ../../../shared/utils/logger, structured-logger         -> jest.fn loggers (logEvent must be a jest.fn)
 *   - openchemlib                                             -> tests/__mocks__/openchemlib.js
 * `MOCKS` below lists them; copy the block from web-quiz-hub-switch-waves.test.js.
 */
const { makeFake } = require('./fake-supabase');

const MOCKS = ['shared/config/supabase', 'shared/services/cache/railway-redis.service', 'shared/services/whatsapp.service',
  'shared/utils/logger', 'shared/utils/structured-logger', 'openchemlib'];

const READ_MS = 8;
// A fixed clock (Wednesday 14 Oct 2026, 11:00 PKT): the payload's dates and tokens are the same on every run.
const NOW = Date.UTC(2026, 9, 14, 6, 0, 0);
const KID = '44444444-4444-4444-8444-000000000001';
const SIB = '44444444-4444-4444-8444-000000000002';
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

// The wave ceiling's case: every child-facing switch the hub reads, on (the ceiling test checks this list is complete).
const CEILING_KEYS = [...ON_KEYS, 'web_quiz_back_nav', 'web_quiz_hub_door', 'web_quiz_challenge_rungs', 'web_quiz_challenge_trail',
  'web_quiz_rich_telemetry', 'web_quiz_bind_way_back', 'web_quiz_guest_home', 'quiz_first_door', 'quiz_maker_page',
  'web_quiz_home_v3', 'web_quiz_stories', 'quiz_student_join'];
// Keys the hub S.reads that are not on/off switches of the child's page.
const NOT_SWITCHES = ['web_quiz_fast', 'web_quiz_brand', 'web_quiz_db_deadline', 'web_quiz_identity'];

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
// off: switches present but set to 'false'.
// sibGone: the second child's row is inactive; otherGrade: the last quiz's video is of another grade than the child;
// manyRuns: 520 old runs ahead of the child's own (a child at the runs read's 500 cap).
function tables({ fast, off = [], loose = false, sibGone = false, otherGrade = false, manyRuns = false, every = false }) {
  const t = {
    app_settings: [...(every ? CEILING_KEYS : ON_KEYS).map((key) => ({ key, value: off.includes(key) ? 'false' : 'true' })), ...(fast ? [{ key: 'web_quiz_fast', value: true }] : [])],
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
  if (sibGone) t.students[1].is_active = false;
  if (otherGrade) t.student_videos.find((v) => v.id === V(2)).grade = '4';
  if (manyRuns) t.web_quiz_challenge_runs.unshift(...Array.from({ length: 520 }, (_, i) => run({ exercise: 'listen', status: 'served', created_at: ago(2000 + i) })));
  if (loose) {
    t.students[0].list_id = null;
    t.class_enrollments = [];
    t.classes = [];
    t.quiz_share_codes.find((c) => c.id === 'sc-new').class_id = null;
  }
  return t;
}

// ── the boundary: every read takes READ_MS and gets its wave ─────────────────────────────────────────
// The run's state, shared with the test files: `reads` (this request's reads), `S.doneMax`, `down` (app_settings unreadable:
// the switches' own failure path), `S.lastReads`, and the hub and token modules of the last boot.
const S = { reads: [], doneMax: 0, down: false, lastReads: [], Hub: null, T: null };
const askedKeys = new Set(); // every app_settings key the code asked for
function seed(opts) {
  const fake = makeFake(tables(opts));
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
      const rec = { t, wave: S.doneMax + 1, at: (new Error().stack.split('\n').slice(2).find((l) => l.includes('services/quiz/') || l.includes('config/')) || '').trim().replace(/.*\/(\S+:\d+):\d+\)?$/, '$1') };
      S.reads.push(rec);
      return new Promise((r) => setTimeout(r, READ_MS))
        .then(() => { S.doneMax = Math.max(S.doneMax, rec.wave); return S.down && t === 'app_settings' ? { data: null, error: { message: 'down' } } : then.call(b, (x) => x); })
        .then(res, rej);
    };
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}
const settle = () => new Promise((r) => setTimeout(r, 12 * READ_MS));

function boot(opts) {
  jest.resetModules();
  S.down = false;
  jest.setSystemTime(NOW);
  seed(opts);
  S.Hub = require('../../../shared/services/quiz/web-quiz-hub');
  S.T = require('../../../shared/services/quiz/web-quiz-token');
}

/** The reads of a request, one line per wave: `wave n: table (caller), ...`. */
const waveList = (rs) => {
  const by = new Map();
  rs.forEach((r) => { if (!by.has(r.wave)) by.set(r.wave, []); by.get(r.wave).push(`${r.t} (${r.at || '?'})`); });
  return [...by.keys()].sort((x, y) => x - y).map((w) => `  wave ${w}: ${by.get(w).join(', ')}`).join('\n');
};

/** One hub request: the payload as the page gets it, its hub_open line, its waves and its reads per table. */
async function measure(token, opts) {
  await settle();
  S.reads = [];
  S.doneMax = 0;
  const { logEvent } = require('../../../shared/utils/structured-logger');
  logEvent.mockClear();
  const out = JSON.stringify(await S.Hub.hub(token, opts));
  const waves = S.doneMax;
  S.lastReads = S.reads.slice();
  if (process.env.WAVES_DEBUG) console.log(S.reads.map((r) => `${r.wave} ${r.t} ${r.at || ''}`).join('\n'));
  const perTable = {};
  S.reads.forEach((r) => { perTable[r.t] = (perTable[r.t] || 0) + 1; });
  const open = logEvent.mock.calls.filter(([name]) => name === 'web_quiz.hub_open').map(([, f]) => f);
  await settle();
  return { out, open: JSON.stringify(open), waves, perTable };
}

const settings = () => ({ WEB_QUIZ_TOKEN_SECRET: 'hub-waves-secret', PORTAL_URL: 'https://portal.example.test', WQ_TOMB_SALT: 'hub-waves-salt' });
/** The fixed clock the fixture needs (call in beforeAll). */
const useClock = () => jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'] });
/** The environment of the hub's tests (call in beforeEach: process.env = { ...saved, ...settings() }). */
const hubEnv = (saved) => { const e = { ...saved, ...settings() }; delete e.WEB_QUIZ_BASE_URL; return e; };

const tokenOne = () => S.T.signHub([KID]);
const tokenTwo = () => S.T.signHub([KID, SIB]);

/**
 * One boot of the hub and its three requests: cold, warm (the second), stale (31 s later: every 30 s cache expired).
 * Resolves { warm, stale, perTable, out, list, staleList } where warm/stale are measure() results, perTable/out/list
 * are the warm request's reads per table, payload and wave list (table, caller), and staleList is the stale one's.
 * Calls jest.resetModules, so call it from a jest test whose file has the boundary mocks and the clock.
 *   switches: keys set to 'false' (present, off); fast: web_quiz_fast; every: all ceiling switches present (else ON_KEYS);
 *   loose: the usual quiz child (no class list); stale: false skips the stale request.
 */
async function hubWaves({ switches = [], fast = true, every = true, loose = false, stale = true } = {}) {
  boot({ fast, every, loose, off: switches });
  const tok = tokenOne();
  await measure(tok, { device: DEVICE });
  const warm = await measure(tok, { device: DEVICE });
  const list = waveList(S.lastReads);
  let late = null;
  let staleList = '';
  if (stale) {
    jest.setSystemTime(NOW + 31 * 1000);
    late = await measure(tok, { device: DEVICE });
    staleList = waveList(S.lastReads);
  }
  return { warm, stale: late, perTable: warm.perTable, out: warm.out, list, staleList };
}

module.exports = {
  MOCKS, S, NOW, READ_MS, KID, SIB, PEER, TEACHER, LIST, CLASS, DEVICE, ON_KEYS, CEILING_KEYS, NOT_SWITCHES,
  tables, seed, settle, boot, waveList, measure, hubWaves, useClock, hubEnv, tokenOne, tokenTwo, askedKeys,
};
