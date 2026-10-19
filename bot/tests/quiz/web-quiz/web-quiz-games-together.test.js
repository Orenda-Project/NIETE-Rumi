'use strict';
/**
 * The games door's reads started together (app_settings web_quiz_games_together, default off; read from the hub's
 * switch cache only, so a cold cache is off and adds no read). The games door (GET /api/wq/doors/h/<t>?d=games) asks
 * whether a read-aloud may start today: the daily cap, then today's count, then the live reads' share of it (the live
 * switch, then the v3 switch, then the story keys), each after the one before; the door's own switches are read before
 * the child's rows; and every clip's storybook-voice check reads the same switch at once (12 reads of one row). On:
 * the cap and the count start together, the live share starts beside the count (its two switches together), the
 * door's switches start beside the child's rows, and one switch read in flight is shared. The answer is the same, byte
 * for byte; only the waits go. Every read takes READ_MS at the boundary (Supabase, faked) and gets a WAVE, 1 + the
 * highest wave of the reads already finished when it started.
 *
 * Supabase, Redis and the loggers are the boundaries; every first-party module on the path runs for real. Production's
 * switches (read-only snapshot, 19 Oct) are the fixture's.
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

// Every switch the quiz services name (each 'web_quiz_…' string in bot/shared/services/quiz, read from the source, so a
// switch added tomorrow is in this list too), for the standing parity rows: fanout on and off must give the same answer
// whatever else is on. The fanout key itself is set by the fixture.
const EVERY_KEY = (() => {
  const fs = require('fs');
  const path = require('path');
  const keys = new Set();
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (f.endsWith('.js')) (fs.readFileSync(f, 'utf8').match(/'web_quiz_[a-z0-9_]+'/g) || []).forEach((k) => keys.add(k.slice(1, -1)));
  });
  walk(path.join(__dirname, '../../../shared/services/quiz'));
  keys.delete('web_quiz_hub_fanout');
  keys.delete('web_quiz_hub_waves2');
  return [...keys].sort();
})();

// loose: the usual quiz child on prod (no class list, no enrolment; their teacher known from the links they played).
// every: every switch in EVERY_KEY on (as JSON true), beside the fixture's own.
const PROD = [{"key": "quiz_author_gates_v2", "value": true}, {"key": "quiz_join_early_tap", "value": true}, {"key": "quiz_join_fast", "value": true}, {"key": "quiz_join_wait_word", "value": true}, {"key": "quiz_maker_page", "value": true}, {"key": "quiz_one_door", "value": true}, {"key": "quiz_report_fold_by_child", "value": true}, {"key": "quiz_student_join", "value": true}, {"key": "quiz_teacher_home", "value": true}, {"key": "quiz_teacher_home_paged", "value": true}, {"key": "quiz_teacher_stories_stale_words", "value": true}, {"key": "web_quiz_adventure_look", "value": true}, {"key": "web_quiz_back_nav", "value": true}, {"key": "web_quiz_bind_way_back", "value": true}, {"key": "web_quiz_brotli", "value": true}, {"key": "web_quiz_card_fast", "value": true}, {"key": "web_quiz_card_ready", "value": true}, {"key": "web_quiz_card_v3", "value": true}, {"key": "web_quiz_challenge", "value": true}, {"key": "web_quiz_challenge_items", "value": true}, {"key": "web_quiz_challenge_keep_audio", "value": true}, {"key": "web_quiz_challenge_listen", "value": true}, {"key": "web_quiz_challenge_missing", "value": true}, {"key": "web_quiz_challenge_option_audio", "value": true}, {"key": "web_quiz_challenge_questions", "value": true}, {"key": "web_quiz_challenge_read_guard", "value": true}, {"key": "web_quiz_challenge_realtime", "value": true}, {"key": "web_quiz_challenge_record", "value": true}, {"key": "web_quiz_challenge_story_voice", "value": true}, {"key": "web_quiz_challenge_sweeper", "value": true}, {"key": "web_quiz_challenge_trail", "value": true}, {"key": "web_quiz_child_quiz_home", "value": true}, {"key": "web_quiz_class_doors", "value": true}, {"key": "web_quiz_db_deadline", "value": true}, {"key": "web_quiz_door_dedupe", "value": true}, {"key": "web_quiz_doors_prefetch", "value": true}, {"key": "web_quiz_early_unlock", "value": true}, {"key": "web_quiz_edge_learn", "value": true}, {"key": "web_quiz_enabled", "value": true}, {"key": "web_quiz_events_v3", "value": true}, {"key": "web_quiz_face_lite", "value": true}, {"key": "web_quiz_fast", "value": true}, {"key": "web_quiz_fixture_rule", "value": {"student_lists": [], "teachers": ["c30c79f1-0c6c-41bc-9909-bc60d1297e48", "d85abd76-4998-4710-bfc8-43e1d046bb99"]}}, {"key": "web_quiz_fold_retry", "value": true}, {"key": "web_quiz_go_link_lang", "value": true}, {"key": "web_quiz_grade_change", "value": true}, {"key": "web_quiz_home_button", "value": true}, {"key": "web_quiz_home_inline", "value": true}, {"key": "web_quiz_home_preload", "value": true}, {"key": "web_quiz_home_v3", "value": true}, {"key": "web_quiz_hub", "value": true}, {"key": "web_quiz_hub_child_memo", "value": true}, {"key": "web_quiz_hub_door", "value": true}, {"key": "web_quiz_hub_early_kid", "value": true}, {"key": "web_quiz_hub_fanout", "value": true}, {"key": "web_quiz_hub_roster_warm", "value": true}, {"key": "web_quiz_hub_waves2", "value": true}, {"key": "web_quiz_identity", "value": "v2"}, {"key": "web_quiz_identity_canon", "value": true}, {"key": "web_quiz_install_prompt", "value": true}, {"key": "web_quiz_invite_ask", "value": "on"}, {"key": "web_quiz_items_v2", "value": true}, {"key": "web_quiz_juice", "value": true}, {"key": "web_quiz_library", "value": true}, {"key": "web_quiz_link_home", "value": true}, {"key": "web_quiz_list_states", "value": true}, {"key": "web_quiz_live_meter", "value": "sky"}, {"key": "web_quiz_live_read_v3", "value": true}, {"key": "web_quiz_look_after", "value": true}, {"key": "web_quiz_lr_repeat", "value": true}, {"key": "web_quiz_minify", "value": true}, {"key": "web_quiz_next_offer", "value": true}, {"key": "web_quiz_old_link_redirect", "value": true}, {"key": "web_quiz_one_button", "value": true}, {"key": "web_quiz_one_voice", "value": {"kbps": 32, "loudness_lufs": -21, "voices": {"en": {"name": "Reyna", "provider": "soniox", "voice": "Reyna"}, "ur": {"name": "Reyna", "provider": "soniox", "voice": "Reyna"}}}}, {"key": "web_quiz_page_lang", "value": true}, {"key": "web_quiz_read_feedback", "value": true}, {"key": "web_quiz_readalong", "value": true}, {"key": "web_quiz_remember_column", "value": true}, {"key": "web_quiz_return_lang", "value": true}, {"key": "web_quiz_rewatch_done", "value": true}, {"key": "web_quiz_rich_telemetry", "value": true}, {"key": "web_quiz_roster_id", "value": true}, {"key": "web_quiz_server_timing", "value": true}, {"key": "web_quiz_share_card_a", "value": true}, {"key": "web_quiz_share_data", "value": true}, {"key": "web_quiz_share_joined", "value": true}, {"key": "web_quiz_share_link_lang", "value": true}, {"key": "web_quiz_share_short", "value": true}, {"key": "web_quiz_share_v4", "value": true}, {"key": "web_quiz_stories", "value": true}, {"key": "web_quiz_stories_polish", "value": true}, {"key": "web_quiz_stories_slow_gaps", "value": true}, {"key": "web_quiz_stories_steady", "value": true}, {"key": "web_quiz_stories_teacher", "value": true}, {"key": "web_quiz_story_warm", "value": true}, {"key": "web_quiz_teachers", "value": "all"}, {"key": "web_quiz_ur_polish", "value": true}, {"key": "web_quiz_video_shelf", "value": true}, {"key": "web_quiz_videos_ur_titles", "value": true}, {"key": "web_quiz_videos_v3", "value": true}, {"key": "web_quiz_wait_home", "value": true}, {"key": "web_quiz_wait_hops", "value": true}, {"key": "web_quiz_wait_ux", "value": true}];
function tables({ games = undefined, prod = false, fast, loose = false, home = false, stories = false, fanout = false, merged = false, every = false, waves2 = false, waves3 = false, embed = false }) {
  const t = {
    app_settings: prod ? [...PROD, ...(games !== undefined ? [{ key: 'web_quiz_games_together', value: games }] : []), { key: 'web_quiz_kid_together', value: true }, { key: 'web_quiz_link_together', value: true }, { key: 'web_quiz_hub_waves3', value: true }, { key: 'web_quiz_hub_embed', value: true }, ...(process.env.PROBE_W3 ? [{ key: 'web_quiz_hub_waves3', value: true }] : []), ...(process.env.PROBE_EMB ? [{ key: 'web_quiz_hub_embed', value: true }] : [])] : [...(every ? EVERY_KEY.filter((key) => key !== 'web_quiz_fast').map((key) => ({ key, value: true })) : ON_KEYS.map((key) => ({ key, value: 'true' }))),
      ...(fast ? [{ key: 'web_quiz_fast', value: true }] : []),
      ...(home ? [{ key: 'web_quiz_home_v3', value: true }] : []), ...(stories ? [{ key: 'web_quiz_stories', value: true }] : []),
      ...(waves2 === true ? [{ key: 'web_quiz_hub_waves2', value: true }] : waves2 ? [{ key: 'web_quiz_hub_waves2', value: waves2 }] : []),
      ...(waves3 ? [{ key: 'web_quiz_hub_waves3', value: true }] : []), ...(embed ? [{ key: 'web_quiz_hub_embed', value: true }] : []),
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
      const st = (new Error().stack || '').split('\n').filter((l) => /shared\/services\/quiz\//.test(l) && !/fake-supabase/.test(l)).slice(0, Number(process.env.PROBE_DEPTH || 3)).map((l) => (l.match(/at (?:async )?([^ (]+)/) || [])[1] + '@' + ((l.match(/quiz\/([\w.-]+):(\d+)/) || []).slice(1, 3).join(':'))).join(' < ');
      const rec = { t, wave: doneMax + 1, st, at: Date.now() };
      if (process.env.PROBE_TABLE === t) { Error.stackTraceLimit = 60; require('fs').appendFileSync(process.env.PROBE_OUT, `--- ${t} wave ${rec.wave}\n` + new Error().stack.split('\n').filter((l) => /services\/|routes\//.test(l)).map((l) => l.trim().replace(/\(.*\/bot\//, '(')).join('\n') + '\n'); }
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
  if (process.env.PROBE_WRAP) {
    const R = require('../../../shared/services/quiz/child-phone-bindings.repo');
    for (const fn of Object.keys(R)) if (typeof R[fn] === 'function' && /^(active|children|rowsFor|bound)/.test(fn)) {
      const orig = R[fn];
      R[fn] = function wrapped(...a) { Error.stackTraceLimit = 60; require('fs').appendFileSync(process.env.PROBE_OUT, `>>> ${fn} (wave now ${doneMax + 1})\n` + new Error().stack.split('\n').slice(2).filter((l) => /services\//.test(l)).slice(0, 6).map((l) => '    ' + l.trim().replace(/\(.*\/bot\/shared\/services\//, '(')).join('\n') + '\n'); return orig.apply(this, a); };
    }
  }
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
  // the tables read by this request, the reads it starts after its answer (a read-ahead) included
  const tablesRead = [...new Set(reads.map((r) => r.t))].sort();
  return { out, open: JSON.stringify(open), waves, perTable, tablesRead };
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
  ['a child on a class list, home + stories on', { loose: false, home: true, stories: true }], ['a loose child, home + stories on', { loose: true, home: true, stories: true }],
  ['every switch on, a child on a class list', { loose: false, every: true }], ['every switch on, a loose child', { loose: true, every: true }]];

// With fanout on its keeper ticks every second in a live process, so each comparison here ticks it once between the
// visits (without it, which switch caches have expired after 31 s depends on the run, and the stale waves with them).
const KEEP = { keepWarm: true };
// the ranked next thing's offer ids are new on every answer (web-quiz-next-offer.js offerId), with the switch or not
const same = (json) => json.replace(/"offer":"[A-Za-z0-9_-]{10}"/g, '"offer":"*"');



// The games door after the Home: its first ask, again, and 31 s later (the 30 s caches gone, the hub's keeper ticked).
async function games(opts) {
  boot({ prod: true, ...opts });
  const tok = tokenOne();
  const hubOut = await Hub.hub(tok, { device: DEVICE });
  const kid = hubOut.kid;
  const Doors = require('../../../shared/services/quiz/web-quiz-hub-doors');
  const out = {};
  for (const which of ['first', 'again', 'stale']) {
    if (which === 'stale') { jest.setSystemTime(NOW + 31 * 1000); await require('../../../shared/services/quiz/web-quiz-hub-warm').tick().catch(() => null); await settle(); }
    await settle(); reads = []; doneMax = 0;
    let ans;
    try { ans = JSON.stringify(await Doors.door(tok, { kid, d: 'games', lang: 'en', device: DEVICE })); } catch (e) { ans = `ERR ${e.status || e.message}`; }
    const waves = doneMax;
    await settle();
    out[which] = { ans, waves, settings: reads.filter((r) => r.t === 'app_settings').length };
  }
  return out;
}

describe.each([['a child on a class list', { loose: false }], ['a loose child', { loose: true }]])('the games door, %s', (name, opts) => {
  test('on: the same answers; the first ask at least two waits fewer, 31 s later at least one, again never more', async () => {
    const off = await games(opts);
    const on = await games({ ...opts, games: true });
    console.log(`${name}: first ${off.first.waves} -> ${on.first.waves}, again ${off.again.waves} -> ${on.again.waves}, stale ${off.stale.waves} -> ${on.stale.waves}; settings reads first ${off.first.settings} -> ${on.first.settings}`);
    for (const k of ['first', 'again', 'stale']) expect([k, on[k].ans]).toEqual([k, off[k].ans]);
    expect(off.first.ans).toMatch(/^\{/);
    expect(on.first.waves).toBeLessThanOrEqual(off.first.waves - 2);
    expect(on.stale.waves).toBeLessThanOrEqual(off.stale.waves - 1);
    expect(on.again.waves).toBeLessThanOrEqual(off.again.waves);
    // the storybook voice's 12 reads of one switch are one
    expect(on.first.settings).toBeLessThanOrEqual(off.first.settings - 10);
  });
});

describe('off', () => {
  test.each([['the string true', 'true'], ['1', 1], ['false', false]])('%s: not on; the same answers, waits and reads as no row', async (_n, value) => {
    const before = await games({ loose: false });
    const odd = await games({ loose: false, games: value });
    expect(odd).toEqual(before);
  });
});

describe('pin', () => {
  test('the hub\'s batched settings read names the key; JSON true only; the cache only (cold is off)', () => {
    jest.resetModules();
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    expect(Flags.KEYS).toContain('web_quiz_games_together');
    Flags._resetCache();
    expect(Flags.nowOf('gamesTogether')).toBe(false);
    Flags.prime([{ key: 'web_quiz_games_together', value: true }]);
    expect(Flags.nowOf('gamesTogether')).toBe(true);
    Flags._resetCache();
    Flags.prime([{ key: 'web_quiz_games_together', value: 'true' }]);
    expect(Flags.nowOf('gamesTogether')).toBe(false);
  });
});
