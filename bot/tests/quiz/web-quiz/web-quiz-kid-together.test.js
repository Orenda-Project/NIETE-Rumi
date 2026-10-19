'use strict';
/**
 * The tap routes' child, read together (app_settings web_quiz_kid_together, default off; read from the hub's switch
 * cache only, so a cold cache is off and adds no read). The video library (/lib/h) and the home's doors (/doors/h) name
 * the child from the hub link (kidFromHub): today its row, then its class list, then its quiz sessions, then their codes
 * and quizzes, then its kept language, one after another; then the library reads the child's row again (the family's
 * grade) and the games door the child's grade (enrolments, then the row, then classes). On: the route runs inside the
 * hub's shared child rows (each child's row, list and enrolments read once per answer), and the child's row (with its
 * class list), its sessions (with their codes and quizzes) and its kept language start together with the phone check;
 * the games door's enrolments too. The answers are the same, byte for byte; only the waits go. Every read takes READ_MS
 * at the boundary and gets a WAVE (the harness of web-quiz-hub-waves2.test.js).
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
  keys.delete('web_quiz_hub_waves3');
  keys.delete('web_quiz_hub_embed');
  keys.delete('web_quiz_kid_together');
  return [...keys].sort();
})();

// The switches the live service runs with (19 Oct 2026, names only; the JSON true ones, and the four plain values below):
// the hub's waits as production has them. The fixture's own keys (fast, fanout, waves2, waves3, embed) are set by it.
const LIVE_KEYS = [
  'web_quiz_adventure_look', 'web_quiz_back_nav', 'web_quiz_bind_way_back', 'web_quiz_brotli', 'web_quiz_card_fast',
  'web_quiz_card_ready', 'web_quiz_card_v3', 'web_quiz_challenge', 'web_quiz_challenge_items',
  'web_quiz_challenge_keep_audio', 'web_quiz_challenge_listen', 'web_quiz_challenge_missing',
  'web_quiz_challenge_option_audio', 'web_quiz_challenge_questions', 'web_quiz_challenge_read_guard',
  'web_quiz_challenge_realtime', 'web_quiz_challenge_record', 'web_quiz_challenge_story_voice',
  'web_quiz_challenge_sweeper', 'web_quiz_challenge_trail', 'web_quiz_child_quiz_home', 'web_quiz_class_doors',
  'web_quiz_db_deadline', 'web_quiz_door_dedupe', 'web_quiz_doors_prefetch', 'web_quiz_early_unlock',
  'web_quiz_edge_learn', 'web_quiz_enabled', 'web_quiz_events_v3', 'web_quiz_face_lite', 'web_quiz_fast',
  'web_quiz_fold_retry', 'web_quiz_go_link_lang', 'web_quiz_grade_change', 'web_quiz_home_button',
  'web_quiz_home_inline', 'web_quiz_home_preload', 'web_quiz_home_v3', 'web_quiz_hub', 'web_quiz_hub_child_memo',
  'web_quiz_hub_door', 'web_quiz_hub_early_kid', 'web_quiz_hub_fanout', 'web_quiz_hub_roster_warm',
  'web_quiz_hub_waves2', 'web_quiz_identity_canon', 'web_quiz_install_prompt', 'web_quiz_items_v2', 'web_quiz_juice',
  'web_quiz_library', 'web_quiz_link_home', 'web_quiz_list_states', 'web_quiz_live_read_v3', 'web_quiz_look_after',
  'web_quiz_lr_repeat', 'web_quiz_minify', 'web_quiz_next_offer', 'web_quiz_old_link_redirect',
  'web_quiz_one_button', 'web_quiz_page_lang', 'web_quiz_read_feedback', 'web_quiz_readalong',
  'web_quiz_remember_column', 'web_quiz_return_lang', 'web_quiz_rewatch_done', 'web_quiz_rich_telemetry',
  'web_quiz_roster_id', 'web_quiz_server_timing', 'web_quiz_share_card_a', 'web_quiz_share_data',
  'web_quiz_share_joined', 'web_quiz_share_link_lang', 'web_quiz_share_short', 'web_quiz_share_v4',
  'web_quiz_stories', 'web_quiz_stories_polish', 'web_quiz_stories_slow_gaps', 'web_quiz_stories_steady',
  'web_quiz_stories_teacher', 'web_quiz_story_warm', 'web_quiz_ur_polish', 'web_quiz_video_shelf',
  'web_quiz_videos_ur_titles', 'web_quiz_videos_v3', 'web_quiz_wait_home', 'web_quiz_wait_hops', 'web_quiz_wait_ux'
];
const LIVE_VALUES = { web_quiz_identity: 'v2', web_quiz_teachers: 'all', web_quiz_live_meter: 'sky', web_quiz_invite_ask: 'on' };
const OWN_KEYS = new Set(['web_quiz_fast', 'web_quiz_hub_fanout', 'web_quiz_hub_waves2', 'web_quiz_hub_waves3', 'web_quiz_hub_embed', 'web_quiz_kid_together']);

// loose: the usual quiz child on prod (no class list, no enrolment; their teacher known from the links they played).
// every: every switch in EVERY_KEY on (as JSON true), beside the fixture's own.
function tables({ fast, loose = false, home = false, stories = false, fanout = false, merged = false, every = false, live = false, waves2 = false, waves3 = false, embed = false, kid = false }) {
  const t = {
    app_settings: [...(live ? [...LIVE_KEYS.filter((key) => !OWN_KEYS.has(key)).map((key) => ({ key, value: true })), ...Object.entries(LIVE_VALUES).map(([key, value]) => ({ key, value }))] : every ? EVERY_KEY.filter((key) => key !== 'web_quiz_fast').map((key) => ({ key, value: true })) : ON_KEYS.map((key) => ({ key, value: 'true' }))),
      ...(fast ? [{ key: 'web_quiz_fast', value: true }] : []),
      ...(home ? [{ key: 'web_quiz_home_v3', value: true }] : []), ...(stories ? [{ key: 'web_quiz_stories', value: true }] : []),
      ...(waves2 === true ? [{ key: 'web_quiz_hub_waves2', value: true }] : waves2 ? [{ key: 'web_quiz_hub_waves2', value: waves2 }] : []),
      ...(waves3 === true ? [{ key: 'web_quiz_hub_waves3', value: true }] : waves3 ? [{ key: 'web_quiz_hub_waves3', value: waves3 }] : []),
      ...(embed === true ? [{ key: 'web_quiz_hub_embed', value: true }] : embed ? [{ key: 'web_quiz_hub_embed', value: embed }] : []),
      ...(kid === true ? [{ key: 'web_quiz_kid_together', value: true }] : kid ? [{ key: 'web_quiz_kid_together', value: kid }] : []),
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
let failEmbed = false;
function seed(opts) {
  const fake = makeFake(tables(opts));
  const from = (t) => {
    const b = fake.from(t);
    const select = b.select;
    let embedded = false;
    b.select = (cols, o) => { if (/\w\(/.test(String(cols || ''))) embedded = true; return select(cols, o); };
    const then = b.then;
    b.then = (res, rej) => {
      const rec = { t, wave: doneMax + 1 };
      reads.push(rec);
      return new Promise((r) => setTimeout(r, READ_MS))
        .then(() => { doneMax = Math.max(doneMax, rec.wave); return failEmbed && embedded ? { data: null, error: { code: 'PGRST200', message: 'no relationship' } } : then.call(b, (x) => x); })
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

const reads0 = (rs) => rs.filter((r) => r.t !== 'app_settings').length;
const BASE = { fast: true, fanout: true, waves2: true, waves3: true, embed: true };
afterEach(() => { failEmbed = false; });

// The library and the two doors for the hub's child, warm (the second ask: the switches' and the bank's caches are
// warm, as on a live process): each answer, its waves and its reads.
async function taps(opts) {
  boot(opts);
  const tok = tokenOne();
  const hubOut = await Hub.hub(tok, { device: DEVICE });
  // the hub's switch cache is what the routes read the switch from: keep it warm, as the hub's keeper does
  const kid = hubOut.kid;
  const Lib = require('../../../shared/services/quiz/web-quiz-library');
  const Doors = require('../../../shared/services/quiz/web-quiz-hub-doors');
  const calls = { lib: () => Lib.libHub(tok, { kid, l: 'en', device: DEVICE }), stories: () => Doors.door(tok, { kid, d: 'stories', lang: 'en', device: DEVICE }), games: () => Doors.door(tok, { kid, d: 'games', lang: 'en', device: DEVICE }) };
  const out = {};
  for (const [name, fn] of Object.entries(calls)) {
    await fn().catch(() => null);
    await Hub.hub(tok, { device: DEVICE });
    await settle();
    reads = [];
    doneMax = 0;
    let ans;
    try { ans = JSON.stringify(await fn()); } catch (e) { ans = `ERR ${e.status || ''} ${JSON.stringify(e.body || e.message)}`; }
    out[name] = { ans, waves: doneMax, reads: reads0(reads) };
    await settle();
  }
  return out;
}
const sameAns = (s) => s.replace(/"offer":"[A-Za-z0-9_-]{10}"/g, '"offer":"*"');

describe.each([['a child on a class list', { loose: false }], ['a loose child', { loose: true }]])('the live service\'s switches, %s', (name, fx) => {
  test('on: the library and both doors answer byte for byte the same, with fewer waves and no more reads', async () => {
    const before = await taps({ ...BASE, live: true, ...fx });
    const on = await taps({ ...BASE, live: true, ...fx, kid: true });
    for (const k of ['lib', 'stories', 'games']) {
      console.log(`${name} ${k}: ${before[k].waves} waves / ${before[k].reads} reads -> ${on[k].waves} / ${on[k].reads}`);
      expect([k, sameAns(on[k].ans)]).toEqual([k, sameAns(before[k].ans)]);
      expect(on[k].ans).not.toMatch(/^ERR/);
      expect([k, on[k].reads <= before[k].reads]).toEqual([k, true]);
    }
    expect(on.lib.waves).toBeLessThanOrEqual(2);
    expect(on.stories.waves).toBeLessThanOrEqual(2);
    expect(on.games.waves).toBeLessThanOrEqual(3);
    expect(on.lib.waves).toBeLessThan(before.lib.waves);
    expect(on.stories.waves).toBeLessThan(before.stories.waves);
    expect(on.games.waves).toBeLessThan(before.games.waves);
  });
});

describe('every switch on: the same answers, never more waves', () => {
  test.each([['a child on a class list', { loose: false }], ['a loose child', { loose: true }]])('%s', async (_n, fx) => {
    const before = await taps({ ...BASE, every: true, ...fx });
    const on = await taps({ ...BASE, every: true, ...fx, kid: true });
    for (const k of ['lib', 'stories', 'games']) {
      expect([k, sameAns(on[k].ans)]).toEqual([k, sameAns(before[k].ans)]);
      expect([k, on[k].waves <= before[k].waves]).toEqual([k, true]);
    }
  });
});

describe('off', () => {
  test.each([['the string true', 'true'], ['1', 1], ['an object', { on: true }]])('%s: not on; the same waves, reads and answers as no row', async (_n, value) => {
    const before = await taps({ ...BASE, live: true });
    const odd = await taps({ ...BASE, live: true, kid: value });
    for (const k of ['lib', 'stories', 'games']) expect([k, sameAns(odd[k].ans), odd[k].waves, odd[k].reads]).toEqual([k, sameAns(before[k].ans), before[k].waves, before[k].reads]);
  });
  test('a forwarded link (another phone): still no child, with the switch on', async () => {
    boot({ ...BASE, live: true, kid: true });
    const tok = tokenOne();
    const kid = (await Hub.hub(tok, { device: DEVICE })).kid;
    const Lib = require('../../../shared/services/quiz/web-quiz-library');
    await expect(Lib.libHub(tok, { kid, l: 'en', device: 'BBBBBBBBBBBBBBBBBBBBBB' })).rejects.toMatchObject({ status: 401 });
  });
});

describe('pin', () => {
  test('the hub\'s batched settings read names the key; JSON true only; the cache only (cold is off)', () => {
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    expect(Flags.KEYS).toContain('web_quiz_kid_together');
    expect(Flags.KID_TOGETHER_KEY).toBe('web_quiz_kid_together');
    Flags._resetCache();
    expect(Flags.kidTogetherNow()).toBe(false);
    Flags.prime([{ key: 'web_quiz_kid_together', value: true }]);
    expect(Flags.kidTogetherNow()).toBe(true);
    Flags._resetCache();
    Flags.prime([{ key: 'web_quiz_kid_together', value: 'true' }]);
    expect(Flags.kidTogetherNow()).toBe(false);
  });
});
