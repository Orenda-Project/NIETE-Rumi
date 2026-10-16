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

function tables({ fast }) {
  return {
    app_settings: [...ON_KEYS.map((key) => ({ key, value: 'true' })), ...(fast ? [{ key: 'web_quiz_fast', value: true }] : [])],
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
      const rec = { t, wave: doneMax + 1, at: process.env.WAVES_DEBUG ? (new Error().stack.split('\n').slice(2).find((l) => l.includes('services/quiz/') || l.includes('config/')) || '').trim().replace(/.*\/(\S+:\d+):\d+\)?$/, '$1') : '' };
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
  record = !fs.existsSync(GOLDEN);
  golden = record ? {} : JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
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

/** The recorded value (first run, before the change) or, after it, the check that this run gives the same. */
function same(name, value) {
  if (record) golden[name] = value;
  else expect(value).toEqual(golden[name]);
}

const tokenOne = () => T.signHub([KID]);
const tokenTwo = () => T.signHub([KID, SIB]);

describe('the kid hub, switch on (web_quiz_fast)', () => {
  test('a child with a teacher card, recommendations, a challenge and the Book: the payload is today\'s, in at most 7 waves warm', async () => {
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
    console.log(`hub warm waves (switch on): ${warm.waves}; reads ${JSON.stringify(warm.perTable)}`);
    expect(warm.waves).toBeLessThanOrEqual(7);
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

  test('every switch stale (31 s later): answered from the cache, read again in the background; same payload, at most 7 waves', async () => {
    boot({ fast: true });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    const warm = await measure(tok, { device: DEVICE });
    jest.setSystemTime(NOW + 31 * 1000);
    const stale = await measure(tok, { device: DEVICE });
    console.log(`hub stale waves (switch on): ${stale.waves}; reads ${JSON.stringify(stale.perTable)}`);
    expect(stale.out).toBe(warm.out);
    expect(stale.open).toBe(warm.open);
    expect(stale.waves).toBeLessThanOrEqual(7);
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

  test('the picker and the locked hub', async () => {
    boot({ fast: false });
    await measure(tokenTwo(), { device: DEVICE });
    same('off_picker', await measure(tokenTwo(), { device: DEVICE }));
    boot({ fast: false });
    await measure(tokenOne(), {});
    same('off_locked', await measure(tokenOne(), {}));
  });
});
