'use strict';
/**
 * The kid hub's round trips (web_quiz_fast). The hub's server time is almost all serial database round trips, so this
 * test counts them: every read takes READ_MS at the boundary (Supabase, faked) and is given a WAVE, 1 + the highest wave
 * of the reads already finished when it started. The page waits for the highest wave.
 *
 * On: once the child and their quizzes are known, the hub's five parts (keep-my-place, the teacher card, the
 * recommendations, Jugnu's corner, the Book) are read together, and a stale switch is answered from its cache while it
 * is read again in the background. The payload (and the hub_open event) is the one recorded before the change (golden),
 * byte for byte. Off: the payload, the reads per table and the waves are exactly the recorded ones.
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

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');

const GOLDEN = path.join(__dirname, 'web-quiz-hub-waves.golden.json');
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
// Keys the hub reads that are not on/off switches of the child's page.
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
// sibGone: the second child's row is inactive; otherGrade: the last quiz's video is of another grade than the child;
// manyRuns: 520 old runs ahead of the child's own (a child at the runs read's 500 cap).
function tables({ fast, loose = false, sibGone = false, otherGrade = false, manyRuns = false, every = false }) {
  const t = {
    app_settings: [...(every ? CEILING_KEYS : ON_KEYS).map((key) => ({ key, value: 'true' })), ...(fast ? [{ key: 'web_quiz_fast', value: true }] : [])],
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
let reads = [];
let doneMax = 0;
let down = false; // app_settings unreadable (the switches' own failure path)
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
      const rec = { t, wave: doneMax + 1, at: (new Error().stack.split('\n').slice(2).find((l) => l.includes('services/quiz/') || l.includes('config/')) || '').trim().replace(/.*\/(\S+:\d+):\d+\)?$/, '$1') };
      reads.push(rec);
      return new Promise((r) => setTimeout(r, READ_MS))
        .then(() => { doneMax = Math.max(doneMax, rec.wave); return down && t === 'app_settings' ? { data: null, error: { message: 'down' } } : then.call(b, (x) => x); })
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
  down = false;
  jest.setSystemTime(NOW);
  seed(opts);
  Hub = require('../../../shared/services/quiz/web-quiz-hub');
  T = require('../../../shared/services/quiz/web-quiz-token');
}

let lastReads = [];
/** The reads of a request, one line per wave: `wave n: table (caller), ...`. */
const waveList = (rs) => {
  const by = new Map();
  rs.forEach((r) => { if (!by.has(r.wave)) by.set(r.wave, []); by.get(r.wave).push(`${r.t} (${r.at || '?'})`); });
  return [...by.keys()].sort((x, y) => x - y).map((w) => `  wave ${w}: ${by.get(w).join(', ')}`).join('\n');
};

/** One hub request: the payload as the page gets it, its hub_open line, its waves and its reads per table. */
async function measure(token, opts) {
  await settle();
  reads = [];
  doneMax = 0;
  const { logEvent } = require('../../../shared/utils/structured-logger');
  logEvent.mockClear();
  const out = JSON.stringify(await Hub.hub(token, opts));
  const waves = doneMax;
  lastReads = reads.slice();
  if (process.env.WAVES_DEBUG) console.log(reads.map((r) => `${r.wave} ${r.t} ${r.at || ''}`).join('\n'));
  const perTable = {};
  reads.forEach((r) => { perTable[r.t] = (perTable[r.t] || 0) + 1; });
  const open = logEvent.mock.calls.filter(([name]) => name === 'web_quiz.hub_open').map(([, f]) => f);
  await settle();
  return { out, open: JSON.stringify(open), waves, perTable };
}

const SAVED = { ...process.env };
let golden;
let record = false;
beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'] });
  golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : {};
});
afterAll(() => {
  if (record) fs.writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 1)}\n`);
  jest.useRealTimers();
  process.env = SAVED;
});
beforeEach(() => {
  process.env = { ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'hub-waves-secret', PORTAL_URL: 'https://portal.example.test', WQ_TOMB_SALT: 'hub-waves-salt' };
  delete process.env.WEB_QUIZ_BASE_URL;
});

/** The recorded value (recorded on today's code, before the change) or, once recorded, the check that this run gives the same. */
function same(name, value) {
  if (!(name in golden)) { golden[name] = value; record = true; return; }
  expect(value).toEqual(golden[name]);
}
/** Today's wave count for a case (recorded on today's code, before the change), for the before -> after line. */
function today(name, waves) {
  if (!(name in golden)) { golden[name] = waves; record = true; }
  return golden[name];
}

const tokenOne = () => T.signHub([KID]);
const tokenTwo = () => T.signHub([KID, SIB]);

describe('the kid hub, switch on (web_quiz_fast)', () => {
  test('a child with a teacher card, recommendations, a challenge and the Book: the payload is today\'s, in at most 6 waves warm', async () => {
    boot({ fast: true });
    await measure(tokenOne(), { device: DEVICE });               // cold: the first read of each switch waits
    const warm = await measure(tokenOne(), { device: DEVICE });
    const p = JSON.parse(warm.out);
    // The fixture reaches every part of the hub.
    expect(p.teacher && p.teacher.code).toBe('NEWQ01');
    expect(p.recs.length).toBe(3);
    expect(p.challenge).toEqual({ on: true });
    expect(p.last && p.last.state).toBe('open');
    expect(p.last.answered).toBe(3);
    expect(p.play && p.play.lantern).toBeTruthy();
    expect(p.book_on).toBe(true);
    expect(p.bind && p.bind.offer).toBe(true);
    expect(p.fast).toBe(true);
    same('on_warm_payload', warm.out);
    same('on_warm_hub_open', warm.open);
    console.log(`hub warm waves (switch on): today ${today('on_warm_waves_today', warm.waves)} -> ${warm.waves}; reads ${JSON.stringify(warm.perTable)}`);
    // A child on a class list: the canonical ids and the hub each read the list (1 wave a loose child has not).
    expect(warm.waves).toBeLessThanOrEqual(6);
  });

  test('the child\'s Jugnu runs are read once for the lantern, the shelf and the Book (not three times)', async () => {
    boot({ fast: true });
    await measure(tokenOne(), { device: DEVICE });
    const warm = await measure(tokenOne(), { device: DEVICE });
    // One read of the child's runs + the class lights' read of the class's runs.
    expect(warm.perTable.web_quiz_challenge_runs).toBe(2);
    // The canonical ids are read once (wave 1), not again for the hub pick.
    expect(warm.perTable.class_enrollments).toBeLessThanOrEqual(4);
  });

  test('every switch stale (31 s later): answered from the cache, read again in the background; same payload, at most 8 waves', async () => {
    boot({ fast: true });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    const warm = await measure(tok, { device: DEVICE });
    jest.setSystemTime(NOW + 31 * 1000);
    const stale = await measure(tok, { device: DEVICE });
    console.log(`hub stale waves (switch on): today ${today('on_stale_waves_today', stale.waves)} -> ${stale.waves}; reads ${JSON.stringify(stale.perTable)}`);
    expect(stale.out).toBe(warm.out);
    expect(stale.open).toBe(warm.open);
    // Every switch is answered from its cache; the 2 waves over warm are the class roster's own 30 s cache (identity roster).
    expect(stale.waves).toBeLessThanOrEqual(8);
  });

  test('a loose child (no class list, no enrolment; the usual quiz child): the payload is today\'s, in at most 5 waves warm', async () => {
    boot({ fast: true, loose: true });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    const warm = await measure(tok, { device: DEVICE });
    const p = JSON.parse(warm.out);
    expect(p.teacher && p.teacher.src).toBe('teacher');
    expect(p.recs.length).toBe(3);
    expect(p.challenge).toEqual({ on: true });
    same('on_loose_payload', warm.out);
    same('on_loose_hub_open', warm.open);
    jest.setSystemTime(NOW + 31 * 1000);
    const stale = await measure(tok, { device: DEVICE });
    expect(stale.out).toBe(warm.out);
    console.log(`hub loose child waves (switch on): warm today ${today('on_loose_waves_today', warm.waves)} -> ${warm.waves}, stale today ${today('on_loose_stale_waves_today', stale.waves)} -> ${stale.waves}`);
    expect(warm.waves).toBeLessThanOrEqual(5);
    expect(stale.waves).toBeLessThanOrEqual(5);
  });

  test('the "who is playing?" picker (two children, none picked): the payload is today\'s', async () => {
    boot({ fast: true });
    await measure(tokenTwo(), { device: DEVICE });
    const warm = await measure(tokenTwo(), { device: DEVICE });
    expect(JSON.parse(warm.out).kids.length).toBe(2);
    same('on_picker_payload', warm.out);
    same('on_picker_hub_open', warm.open);
  });

  test('the locked hub (no device): the payload is today\'s, in 3 waves', async () => {
    boot({ fast: true });
    await measure(tokenOne(), {});
    const warm = await measure(tokenOne(), {});
    expect(JSON.parse(warm.out).locked).toBe(true);
    same('on_locked_payload', warm.out);
    console.log(`hub locked waves (switch on): ${warm.waves}`);
    expect(warm.waves).toBeLessThanOrEqual(3);
  });
});

// Old vs new on the same fake DB where no recorded case reaches: switch off is today's hub (the golden cases below
// prove it), and on the hub's payload is the off one plus `fast: true` (as every recorded case shows).
describe('the kid hub, switch on: the same payload as switch off where the early reads guess', () => {
  // req(): the request's options, made once the modules are loaded (a chip is signed with the token module).
  const both = async (opts, tok, req) => {
    boot({ ...opts, fast: false });
    await measure(tok(), req());
    const off = await measure(tok(), req());
    boot({ ...opts, fast: true });
    await measure(tok(), req());
    const on = await measure(tok(), req());
    const p = JSON.parse(on.out);
    expect(p.fast).toBe(true);
    delete p.fast;
    expect(JSON.stringify(p)).toBe(off.out);
    expect(on.open).toBe(off.open);
    return { on, off };
  };
  const chip = (id) => T.chipId('h', id);

  test('two children, the second picked by its chip', async () => {
    const { on } = await both({}, tokenTwo, () => ({ device: DEVICE, kid: chip(SIB) }));
    expect(JSON.parse(on.out).kid).toBe(chip(SIB));
  });

  test('the chip names a child whose row is gone: the other child opens (the early reads were for the wrong child)', async () => {
    const { on } = await both({ sibGone: true }, tokenTwo, () => ({ device: DEVICE, kid: chip(SIB) }));
    expect(JSON.parse(on.out).kid).toBe(chip(KID));
  });

  test('the last quiz\'s video is of another grade: the recommendations are of that grade', async () => {
    await both({ otherGrade: true }, tokenOne, () => ({ device: DEVICE }));
  });

  test('a child at the runs read\'s 500 cap: the lantern and the shelf read their own runs, as today', async () => {
    const { on } = await both({ manyRuns: true }, tokenOne, () => ({ device: DEVICE }));
    expect(JSON.parse(on.out).play).toBeTruthy();
  });
});

describe('the kid hub, switch off: exactly today\'s (golden: payload, reads per table, waves)', () => {
  test('a child with every part', async () => {
    boot({ fast: false });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    const warm = await measure(tok, { device: DEVICE });
    jest.setSystemTime(NOW + 31 * 1000);
    const stale = await measure(tok, { device: DEVICE });
    console.log(`hub waves (switch off): warm ${warm.waves}, stale ${stale.waves}`);
    same('off_warm', warm);
    same('off_stale', stale);
  });

  test('a loose child', async () => {
    boot({ fast: false, loose: true });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    same('off_loose', await measure(tok, { device: DEVICE }));
  });

  test('the picker and the locked hub', async () => {
    boot({ fast: false });
    await measure(tokenTwo(), { device: DEVICE });
    same('off_picker', await measure(tokenTwo(), { device: DEVICE }));
    boot({ fast: false });
    await measure(tokenOne(), {});
    same('off_locked', await measure(tokenOne(), {}));
  });
});

// ── the standing ceiling ─────────────────────────────────────────────────────────────────────────────
// The hub's bot time is serial database round trips (about 250 ms each in production). This is the most it may cost
// with every child switch on and the fast page on: a change that adds a round trip to the hub's chain goes red here.
// Add your part as a parallel branch instead (HUB_BRANCHES in web-quiz-hub.js), and read nothing the hub already read.
// Raise a ceiling only with the reason in the change's description.
const HUB_CEILING = { warm: 9, stale: 12 };
const overCeiling = (what, got, max) => `${what}: ${got} serial round trips, the ceiling is ${max}. The waves (table, caller):\n${waveList(lastReads)}`;

describe('the hub\'s round-trip ceiling (every child switch on, fast page on)', () => {
  test(`at most ${HUB_CEILING.warm} waves warm, ${HUB_CEILING.stale} stale (31 s, every 30 s cache expired)`, async () => {
    boot({ fast: true, every: true });
    askedKeys.clear();
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    const warm = await measure(tok, { device: DEVICE });
    const warmList = lastReads;
    const p = JSON.parse(warm.out);
    expect(p.fast).toBe(true);
    expect(p.teacher && p.recs.length && p.challenge && p.play && p.book_on).toBeTruthy();
    jest.setSystemTime(NOW + 31 * 1000);
    const stale = await measure(tok, { device: DEVICE });
    console.log(`hub ceiling: warm ${warm.waves} (ceiling ${HUB_CEILING.warm}), stale ${stale.waves} (ceiling ${HUB_CEILING.stale})\n${waveList(warmList)}`);
    if (warm.waves > HUB_CEILING.warm) { lastReads = warmList; throw new Error(overCeiling('hub, warm', warm.waves, HUB_CEILING.warm)); }
    if (stale.waves > HUB_CEILING.stale) throw new Error(overCeiling('hub, stale', stale.waves, HUB_CEILING.stale));
    // Every switch the hub asked for is on in this case (a new switch joins CEILING_KEYS, so the ceiling sees its reads).
    const missing = [...askedKeys].filter((k) => !CEILING_KEYS.includes(k) && !NOT_SWITCHES.includes(k)).sort();
    expect(missing).toEqual([]);
  });
});

describe('the hub\'s parallel branches (HUB_BRANCHES)', () => {
  test('one more branch with its own read runs beside the others: no extra wave, the payload unchanged, the shared context handed in', async () => {
    boot({ fast: true });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    const before = await measure(tok, { device: DEVICE });
    const seen = [];
    Hub.addHubBranch({ name: 'probe', run: async (s) => {
      seen.push({ kid: s.chosen.id, grade: s.ctx.grade, runs: Boolean(s.runs), flags: Boolean(s.f && s.f.hub) });
      const { data } = await require('../../../shared/config/supabase').from('students').select('id').eq('id', s.chosen.id);
      return data;
    } });
    const after = await measure(tok, { device: DEVICE });
    expect(seen).toEqual([{ kid: KID, grade: '3', runs: true, flags: true }]);
    expect(after.out).toBe(before.out);
    expect(after.perTable.students).toBe(before.perTable.students + 1);
    expect(after.waves).toBe(before.waves);
    expect(() => Hub.addHubBranch({ name: 'probe', run: () => null })).toThrow(/already/);
    expect(Hub.HUB_BRANCHES.map((b) => b.name)).toEqual(['extras', 'teacher', 'answered', 'recs', 'play', 'bits', 'home', 'bound', 'probe']);
  });
});

describe('a stale switch (30 s cache)', () => {
  const FLAG_MODULES = [
    ['hub flags', () => require('../../../shared/services/quiz/web-quiz-hub-flags').flags(), (v) => v.hub],
    ['identity flags', () => require('../../../shared/services/quiz/web-quiz-identity-flags').flags(), (v) => v.canon],
    ['hub play switches', () => require('../../../shared/services/quiz/web-quiz-hub-play').switches(), (v) => v.v2],
    ['challenge record switch', () => require('../../../shared/services/quiz/web-quiz-challenge').recordOn(), (v) => v],
    ['challenge listen switch', () => require('../../../shared/services/quiz/web-quiz-challenge').listenOn(), (v) => v],
    ['book flags', () => require('../../../shared/services/quiz/web-quiz-book').flags(), (v) => v.book],
    ['home v3 flags', () => require('../../../shared/services/quiz/web-quiz-hub-home').flags(), (v) => v.home],
    ['student join flags', () => require('../../../shared/services/quiz/web-quiz-student-join').flags(), (v) => v.on],
    ['Urdu polish', () => require('../../../shared/services/quiz/web-quiz-ur-polish').ui(), (v) => Boolean(v && v.ur2)],
  ];
  const timed = async (fn) => { reads = []; doneMax = 0; const v = await fn(); return { v, waves: doneMax }; };

  test.each(FLAG_MODULES)('%s, switch on: answered from the cache at once; a failed background read keeps the value', async (_, read, pick) => {
    boot({ fast: true, every: true });
    await require('../../../shared/services/quiz/web-quiz-fast').on();
    await settle();
    expect(pick((await timed(read)).v)).toBe(true);                 // cold: waited for, as today
    jest.setSystemTime(NOW + 31 * 1000);
    require('../../../shared/services/quiz/web-quiz-fast').on();     // the fast switch itself read fresh (it fails closed)
    await settle();
    down = true;
    const stale = await timed(read);
    expect(pick(stale.v)).toBe(true);
    expect(stale.waves).toBe(0);                                     // nothing waited for
    await settle();
    expect(reads.filter((r) => r.t === 'app_settings').length).toBeGreaterThanOrEqual(1); // read again in the background
    expect(pick((await timed(read)).v)).toBe(true);                  // the failed read kept the value
    await settle();
    down = false;
    await timed(read);
    await settle();
    jest.setSystemTime(NOW + 32 * 1000);
    expect(pick((await timed(read)).v)).toBe(true);
  });

  test.each(FLAG_MODULES)('%s, switch off: a stale cache waits for its read, as today', async (_, read, pick) => {
    boot({ fast: false, every: true });
    await require('../../../shared/services/quiz/web-quiz-fast').on();
    await settle();
    expect(pick((await timed(read)).v)).toBe(true);
    jest.setSystemTime(NOW + 31 * 1000);
    expect((await timed(read)).waves).toBeGreaterThanOrEqual(1);
  });

  test('switch on: a stale switch read by many requests at once is read again only once', async () => {
    boot({ fast: true });
    await require('../../../shared/services/quiz/web-quiz-fast').on();
    await settle();
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    await Flags.flags();
    await require('../../../shared/services/quiz/web-quiz-fast').on();
    jest.setSystemTime(NOW + 31 * 1000);
    reads = [];
    await Promise.all([Flags.flags(), Flags.flags(), Flags.flags()]);
    await settle();
    // the hub flags' own read once (the fast switch's own background read may be the other app_settings read)
    expect(reads.filter((r) => r.t === 'app_settings').length).toBeLessThanOrEqual(2);
  });
});
