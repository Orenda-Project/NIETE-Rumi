'use strict';
/**
 * The light Urdu face (app_settings web_quiz_face_lite) on the kid hub's answer, through the bot's internal route: the
 * switch rides the hub flags' one batched read and adds no read and no serial round trip. Every read takes READ_MS at
 * the boundary (Supabase, faked) and is given a WAVE, 1 + the highest wave of the reads already finished when it
 * started; the page waits for the highest wave.
 *
 * Asserted for the fast page off and on, warm and 31 s later (every 30 s cache stale), for a child on a class list and
 * for the usual loose child: OFF = the recorded numbers exactly (waves, app_settings reads, every table's reads),
 * ON = OFF (the switch has no rows of its own to add), and the answer is the switch-off answer plus `"fl":true` in
 * its `ui`. Supabase, Redis and the loggers are the boundaries; every first-party module on the path runs for real.
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

// OFF: the hub's waves and app_settings reads through GET /hub/:token with this change and the switch off, recorded
// (the same numbers as the code before it: the key joins a read that already happens).
const OFF = {
  class: { fastOff: { warm: { waves: 26, settings: 0 }, stale: { waves: 39, settings: 16 } }, fastOn: { warm: { waves: 24, settings: 0 }, stale: { waves: 37, settings: 16 } } },
  loose: { fastOff: { warm: { waves: 21, settings: 0 }, stale: { waves: 32, settings: 16 } }, fastOn: { warm: { waves: 20, settings: 0 }, stale: { waves: 31, settings: 16 } } },
};

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

// loose: the usual quiz child on prod (no class list, no enrolment; their teacher known from the links they played).
function tables({ fast, loose = false, home = false, stories = false, faceLite }) {
  const t = {
    app_settings: [...ON_KEYS.map((key) => ({ key, value: 'true' })), ...(fast ? [{ key: 'web_quiz_fast', value: true }] : []),
      ...(home ? [{ key: 'web_quiz_home_v3', value: true }] : []), ...(stories ? [{ key: 'web_quiz_stories', value: true }] : []),
      ...(faceLite !== undefined ? [{ key: 'web_quiz_face_lite', value: faceLite }] : [])],
    students: [
      { id: KID, student_name: 'Test Child One', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, merged_into: null, status: null, created_at: ago(500) },
      { id: SIB, student_name: 'Test Child Two', student_name_urdu: null, self_reported_class: '5', list_id: null, is_active: true, merged_into: null, status: null, created_at: ago(400) },
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

let T;
let server;
let base;
async function boot(opts) {
  jest.resetModules();
  jest.setSystemTime(NOW);
  seed(opts);
  T = require('../../../shared/services/quiz/web-quiz-token');
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
}
const close = () => new Promise((r) => (server ? server.close(r) : r()));

/** One hub request through the route: the answer as the edge gets it, its waves and its reads per table. */
async function measure(token) {
  await settle();
  reads = [];
  doneMax = 0;
  const res = await fetch(`${base}/hub/${token}`, { headers: { 'x-api-key': 'route-key', 'x-wq-device': DEVICE } });
  const out = await res.text();
  const waves = doneMax;
  const perTable = {};
  reads.forEach((r) => { perTable[r.t] = (perTable[r.t] || 0) + 1; });
  await settle();
  return { status: res.status, out, waves, perTable };
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
  process.env = { ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'hub-waves-secret', PORTAL_URL: 'https://portal.example.test', WQ_TOMB_SALT: 'hub-waves-salt', INTERNAL_API_KEY: 'route-key' };
  delete process.env.WEB_QUIZ_BASE_URL;
});

/** Warm (the second request) and stale (31 s later) for one fixture. */
async function warmAndStale(opts) {
  await boot(opts);
  try {
    const tok = T.signHub([KID]);
    await measure(tok);
    const warm = await measure(tok);
    jest.setSystemTime(NOW + 31 * 1000);
    const stale = await measure(tok);
    return { warm, stale };
  } finally { await close(); }
}
const settingsOf = (m) => m.perTable.app_settings || 0;
const dropLite = (out) => out.replace(/,"fl":true/, '');
const nums = (m) => ({ waves: m.waves, settings: settingsOf(m) });

describe.each([['a child on a class list', 'class', false], ['a loose child', 'loose', true]])('the light Urdu face on the kid hub: %s', (_name, who, loose) => {
  describe.each([['fast page off', 'fastOff', false], ['fast page on (both on)', 'fastOn', true]])('%s', (_f, fastKey, fast) => {
    test('OFF = recorded, ON = OFF, warm and stale; the answer says fl only when on', async () => {
      const off = await warmAndStale({ fast, loose });
      const on = await warmAndStale({ fast, loose, faceLite: true });
      console.log(`face lite, hub (${who}, ${fastKey}): ${JSON.stringify({ off: { warm: nums(off.warm), stale: nums(off.stale) }, on: { warm: nums(on.warm), stale: nums(on.stale) } })}`);
      expect([off.warm.status, on.warm.status]).toEqual([200, 200]);
      expect(JSON.parse(on.warm.out).ui).toEqual({ ur2: true, fl: true });
      expect(JSON.parse(on.stale.out).ui).toEqual({ ur2: true, fl: true });
      expect(JSON.parse(off.warm.out).ui).toEqual({ ur2: true });
      expect(off.stale.out).not.toMatch(/"fl"/);
      expect(dropLite(on.warm.out)).toBe(off.warm.out);
      const rec = OFF[who][fastKey];
      // OFF: exactly the recorded numbers
      expect({ warm: nums(off.warm), stale: nums(off.stale) }).toEqual(rec);
      // ON = OFF: no read of its own, no extra wave, the same reads of every table
      expect({ warm: nums(on.warm), stale: nums(on.stale) }).toEqual(rec);
      expect(on.warm.perTable).toEqual(off.warm.perTable);
      expect(on.stale.perTable).toEqual(off.stale.perTable);
    });
  });
});
