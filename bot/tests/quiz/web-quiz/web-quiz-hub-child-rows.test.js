'use strict';
/**
 * The child's own rows read once per hub answer (app_settings web_quiz_hub_child_memo, default off). On: the children's
 * students rows, their class enrolments and their class lists are read once for one hub answer, and every part of the
 * answer that asks for them again (the identity lookup, the hub's own rows, the challenge's grade, the teacher card's
 * classes, the Book's class, the pick record) shares that read. Nothing is kept past the answer. The answer is the
 * same, byte for byte, and its hub_open line too; only the reads go. Every read takes READ_MS at the boundary (Supabase,
 * faked) and is given a WAVE (the same harness as web-quiz-hub-fanout-waves.test.js).
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
function tables({ fast, loose = false, home = false, stories = false, fanout = false, merged = false, memo = false }) {
  const t = {
    app_settings: [...ON_KEYS.map((key) => ({ key, value: 'true' })), ...(fast ? [{ key: 'web_quiz_fast', value: true }] : []),
      ...(home ? [{ key: 'web_quiz_home_v3', value: true }] : []), ...(stories ? [{ key: 'web_quiz_stories', value: true }] : []),
      ...(fanout === true ? [{ key: 'web_quiz_hub_fanout', value: true }] : fanout ? [{ key: 'web_quiz_hub_fanout', value: fanout }] : []),
      ...(memo === true ? [{ key: 'web_quiz_hub_child_memo', value: true }] : memo ? [{ key: 'web_quiz_hub_child_memo', value: memo }] : [])],
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
  // the keeper (reads together) ticks each second in real time: stopped, so the next visit's waves never race it
  try { require('../../../shared/services/quiz/web-quiz-hub-warm')._stop(); } catch (_) { /* not loaded */ }
  const waves = doneMax;
  const perTable = {};
  const own = {};
  reads.forEach((r) => { perTable[r.t] = (perTable[r.t] || 0) + 1; if (r.own) own[r.t] = (own[r.t] || 0) + 1; });
  const open = logEvent.mock.calls.filter(([name]) => name === 'web_quiz.hub_open').map(([, f]) => f);
  await settle();
  return { out, open: JSON.stringify(open), waves, perTable, own };
}

const SAVED = { ...process.env };
beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => {
  jest.useRealTimers();
  process.env = SAVED;
});
beforeEach(() => {
  failCols = null;
  process.env = { ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'hub-rows-secret', PORTAL_URL: 'https://portal.example.test', WQ_TOMB_SALT: 'hub-rows-salt' };
  delete process.env.WEB_QUIZ_BASE_URL;
});
afterEach(() => { try { require('../../../shared/services/quiz/web-quiz-hub-warm')._stop(); } catch (_) { /* not loaded */ } });

/** Warm (the second request, 2 s after the first: a new visit) and stale (31 s later) for one fixture and token. */
async function warmAndStale(opts, ids = [KID]) {
  boot(opts);
  const tok = T.signHub(ids);
  await measure(tok, { device: DEVICE });
  jest.setSystemTime(NOW + 2 * 1000);
  const warm = await measure(tok, { device: DEVICE });
  jest.setSystemTime(NOW + 33 * 1000);
  const stale = await measure(tok, { device: DEVICE });
  return { warm, stale };
}

const FIXTURES = [['a child on a class list', { loose: false }], ['a loose child', { loose: true }],
  ['a child on a class list, home + stories on', { loose: false, home: true, stories: true }], ['a loose child, home + stories on', { loose: true, home: true, stories: true }]];
const MODES = [['reads one after another', false], ['reads together', true]];

describe.each(FIXTURES)('the child\'s rows once per answer: %s', (_name, fx) => {
  describe.each(MODES)('%s', (_mode, fanout) => {
    test('on: the answer and its hub_open line are byte for byte the same as off, warm and stale', async () => {
      const off = await warmAndStale({ fast: true, ...fx, fanout });
      const on = await warmAndStale({ fast: true, ...fx, fanout, memo: true });
      expect(on.warm.out).toBe(off.warm.out);
      expect(on.stale.out).toBe(off.stale.out);
      expect(on.warm.open).toBe(off.warm.open);
      expect(on.stale.open).toBe(off.stale.open);
    });

    test('on: each of the child\'s own tables is read at most once per answer; no table more often than off; no more waves', async () => {
      const off = await warmAndStale({ fast: true, ...fx, fanout });
      const on = await warmAndStale({ fast: true, ...fx, fanout, memo: true });
      console.log(`own-row reads (${_name}, ${_mode}): off ${JSON.stringify(off.warm.own)} warm / ${JSON.stringify(off.stale.own)} stale; on ${JSON.stringify(on.warm.own)} / ${JSON.stringify(on.stale.own)}; waves off ${off.warm.waves}/${off.stale.waves} on ${on.warm.waves}/${on.stale.waves}`);
      for (const k of ['warm', 'stale']) {
        for (const t of OWN) expect([k, t, on[k].own[t] || 0]).toEqual([k, t, Math.min(1, on[k].own[t] || 0)]);
        for (const [t, n] of Object.entries(on[k].perTable)) expect([k, t, n]).toEqual([k, t, Math.min(n, off[k].perTable[t] || 0)]);
        expect(on[k].waves).toBeLessThanOrEqual(off[k].waves);
      }
      const total = (r) => Object.values(r.own).reduce((a, b) => a + b, 0);
      expect(total(on.warm)).toBeLessThan(total(off.warm));
      expect(total(on.stale)).toBeLessThan(total(off.stale));
    });
  });
});

describe('two children on one phone (the picker, then a child picked)', () => {
  test.each(MODES)('%s: on gives the same answers as off, with each child\'s rows read once', async (_mode, fanout) => {
    const off = await warmAndStale({ fast: true, fanout }, [KID, SIB]);
    const on = await warmAndStale({ fast: true, fanout, memo: true }, [KID, SIB]);
    expect(on.warm.out).toBe(off.warm.out);
    expect(on.stale.out).toBe(off.stale.out);
    for (const k of ['warm', 'stale']) for (const t of OWN) expect([k, t, on[k].own[t] || 0]).toEqual([k, t, Math.min(1, on[k].own[t] || 0)]);
  });
});

describe('the identity lookup gives another id (a merged record on the link)', () => {
  test.each(MODES)('%s: on gives the same answer and hub_open line as off', async (_mode, fanout) => {
    const off = await warmAndStale({ fast: true, merged: true, fanout }, [OLD]);
    const on = await warmAndStale({ fast: true, merged: true, fanout, memo: true }, [OLD]);
    expect(on.warm.out).toBe(off.warm.out);
    expect(on.stale.out).toBe(off.stale.out);
    expect(on.warm.open).toBe(off.warm.open);
    expect(JSON.parse(on.warm.out).kids.length).toBe(1);
  });
});

describe('a refused shared read', () => {
  test('each part then reads its own rows as today: the same answer as off', async () => {
    const off = await warmAndStale({ fast: true, fanout: true });
    failCols = { t: 'students', cols: require('../../../shared/services/quiz/web-quiz-hub-child-rows').COLS.students };
    const on = await warmAndStale({ fast: true, fanout: true, memo: true });
    expect(on.warm.out).toBe(off.warm.out);
    expect(on.stale.out).toBe(off.stale.out);
  });
});

describe('off is today', () => {
  test.each([['the string true', 'true'], ['1', 1], ['an object', { on: true }]])('%s: not on; the same reads, waves and answer as no row', async (_n, value) => {
    for (const fanout of [false, true]) {
      const none = await warmAndStale({ fast: true, fanout });
      const odd = await warmAndStale({ fast: true, fanout, memo: value });
      expect(odd.warm.out).toBe(none.warm.out);
      expect(odd.stale.out).toBe(none.stale.out);
      expect({ warm: odd.warm.perTable, stale: odd.stale.perTable }).toEqual({ warm: none.warm.perTable, stale: none.stale.perTable });
      expect({ warm: odd.warm.waves, stale: odd.stale.waves }).toEqual({ warm: none.warm.waves, stale: none.stale.waves });
    }
  });

  test('on, outside a hub answer (the challenge page\'s own grade): the same reads as off', async () => {
    const count = async (memo) => {
      boot({ fast: true, memo });
      await measure(T.signHub([KID]), { device: DEVICE }); // fills the hub's switch cache
      reads = [];
      const g = await require('../../../shared/services/quiz/web-quiz-challenge').gradeOf({ studentId: KID });
      return { g, n: reads.length };
    };
    expect(await count(true)).toEqual(await count(false));
  });

  test('a shared read is never kept past its answer: a row changed between visits is read afresh', async () => {
    boot({ fast: true, fanout: true, memo: true });
    const tok = T.signHub([KID]);
    await measure(tok, { device: DEVICE });
    const before = JSON.parse((await measure(tok, { device: DEVICE })).out);
    const db = require('../../../shared/config/supabase');
    const { data: rows } = await db.from('students').select('id').eq('id', KID);
    expect(rows.length).toBe(1);
    seed({ fast: true, fanout: true, memo: true }); // a fresh database: same rows but the child renamed
    const fresh = require('../../../shared/config/supabase');
    const from = fresh.from;
    fresh.from = (t) => {
      const b = from(t);
      if (t !== 'students') return b;
      const then = b.then;
      b.then = (res, rej) => then.call(b, (x) => ({ ...x, data: Array.isArray(x.data) ? x.data.map((r) => (r.id === KID ? { ...r, student_name: 'Zoya Testwala' } : r)) : x.data && x.data.id === KID ? { ...x.data, student_name: 'Zoya Testwala' } : x.data })).then(res, rej);
      return b;
    };
    jest.setSystemTime(NOW + 5 * 1000);
    const after = JSON.parse((await measure(tok, { device: DEVICE })).out);
    expect(before.kids[0].first).toBe('Sana');
    expect(after.kids[0].first).toBe('Zoya');
  });
});
