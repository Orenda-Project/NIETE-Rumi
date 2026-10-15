'use strict';
/**
 * The Jugnu tab's confirm queue fed by the REAL join-queue service (web-quiz-join-queue, switch
 * web_quiz_identity_canon), with every switch on: the row keys it returns (first, candidate_first, father_first,
 * candidate_father_first) reach the page; the queue's own words come from the copy deck; the forward button needs
 * the class link's switch as well as a live class_links row.
 *
 * The routes, the tab's data and page modules and the join-queue service run for real. Faked: Supabase (in-memory,
 * filters applied, and a select or filter naming a column the schema mirror lacks answers 42703 like PostgREST), the
 * loggers, and the class link's switch module (shipped separately: a virtual stand-in that reads the same
 * app_settings rows). Children are invented "Testwala" fixtures; the page must never show the surname.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true), isAvailable: () => true,
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-class-link-flags', () => {
  const on = (rows, k) => rows.some((r) => r.key === k && (r.value === true || r.value === 'true'));
  return {
    classLinkOn: jest.fn(async () => {
      const { data } = await require('../../../shared/config/supabase').from('app_settings').select('key, value')
        .in('key', ['web_quiz_class_link', 'web_quiz_challenge_v2', 'web_quiz_challenge']);
      return ['web_quiz_class_link', 'web_quiz_challenge_v2', 'web_quiz_challenge'].every((k) => on(data || [], k));
    }),
  };
}, { virtual: true });

const express = require('express');
const { makeFake } = require('./fake-supabase');
const { strictFrom } = require('./strict-columns');

const NOW = Date.parse('2026-10-15T09:30:00Z');
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const CLASS = 'c1a55000-0000-4000-8000-000000000001';
const r = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const c = (n) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = (n) => `92000000${String(600 + n).padStart(4, '0')}`;
const at = (iso) => new Date(Date.parse(iso)).toISOString();

const SWITCHES = ['web_quiz_teacher_jugnu', 'web_quiz_challenge_v2', 'web_quiz_challenge', 'web_quiz_hub', 'web_quiz_identity_canon', 'web_quiz_class_link'];
// Every table this tab and the queue read is checked against the schema mirror. students.phone and
// students.enrolled_by_user_id are read by the join-queue on the base already and are on the base's own list.
const CHECKED = ['student_lists', 'class_enrollments', 'students', 'web_quiz_challenge_runs', 'child_rungs', 'child_phone_bindings',
  'class_links', 'challenge_passages', 'merge_log', 'app_settings', 'class_teachers', 'classes'];
const BASE_ITEMS = { students: ['phone', 'enrolled_by_user_id'] };

const roster = (id, name, father) => ({ id, list_id: LIST, roll_number: 1, student_name: name, student_name_urdu: null, father_name: father, status: 'active', is_active: true, merged_into: null });
const loose = (id, name, father, extra = {}) => ({ id, list_id: null, student_name: name, student_name_urdu: null, father_name: father, status: 'active', is_active: true,
  merged_into: null, enrolled_by_user_id: TEACHER, self_reported_class: '3', phone: null, ...extra });
const sess = (id, student, extra = {}) => ({ id, student_id: student, quiz_id: QUIZ, share_code_id: SC, parent_phone: null, device_ref: null, status: 'completed',
  created_at: at('2026-10-14T04:00:00Z'), ...extra });

let DB;
let fake;
function seed({ off = [] } = {}) {
  DB = {
    app_settings: SWITCHES.filter((k) => !off.includes(k)).map((key) => ({ key, value: 'true' })),
    users: [{ id: TEACHER, preferred_language: 'en' }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en', quiz_source: 'transcript',
      status: 'report_sent', list_id: null, created_at: at('2026-10-14T03:00:00Z'), meta: { share_code_id: SC } }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, active: true, expires_at: null, language: 'en', class_id: null, created_at: at('2026-10-14T03:00:00Z') }],
    quiz_questions: [], quiz_answers: [],
    classes: [{ id: CLASS, grade_code: '3', is_active: true }],
    class_teachers: [{ class_id: CLASS, teacher_user_id: TEACHER, is_active: true }],
    student_lists: [{ id: LIST, class_name: 'Grade 3', section: 'B', user_id: TEACHER, is_active: true, class_id: CLASS }],
    class_enrollments: [1, 2, 3].map((n) => ({ class_id: CLASS, student_id: r(n), is_active: true })),
    students: [
      roster(r(1), 'Omar Testwala', 'Tariq Testwala'),
      roster(r(2), 'Sara Testwala', null),
      roster(r(3), 'Hina Testwala', null),
      // Two chat children typed the roster's exact name, each with a page child of the same name on another device:
      // both are the identity rule's "blocked" tier, the one the queue serves.
      loose(c(1), 'Omar Testwala', 'Javed Testwala', { phone: P(1) }),
      loose(c(11), 'Omar  Testwala', null),
      loose(c(2), 'Sara Testwala', null, { phone: P(2) }),
      loose(c(22), 'Sara  Testwala', null),
    ],
    quiz_sessions: [
      sess('s1', c(1), { parent_phone: P(1), device_ref: 'dev-1' }),
      sess('s11', c(11), { device_ref: 'dev-11' }),
      sess('s2', c(2), { parent_phone: P(2), device_ref: 'dev-2' }),
      sess('s22', c(22), { device_ref: 'dev-22' }),
    ],
    web_quiz_challenge_runs: [],
    child_rungs: [],
    child_phone_bindings: [],
    merge_log: [],
    class_links: [{ code: 'K7QX2M9P', class_id: CLASS, teacher_id: TEACHER, term_code: '2026-27b', expires_at: at('2027-03-31T18:59:59Z'), revoked_at: null }],
    challenge_passages: [{ passage_id: 'en.read.1.sparrow', lang: 'en', status: 'reviewed', title_en: 'The Kind Sparrow', title_ur: 'مہربان چڑیا', released_at: at('2026-10-11T19:00:00Z') }],
  };
  fake = makeFake(DB);
  Object.assign(require('../../../shared/config/supabase'), { from: strictFrom(fake.from, CHECKED, BASE_ITEMS), rpc: fake.rpc });
}

let server;
let base;
let Token;
async function boot(opts) {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  seed(opts);
  Token = require('../../../shared/services/quiz/teacher-report-token');
  const app = express();
  app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
}
beforeEach(() => { jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] }); });
afterEach(async () => { jest.useRealTimers(); if (server) await new Promise((res) => server.close(res)); server = null; });

const get = (p) => fetch(`${base}${p}`, { headers: { 'x-api-key': 'test-key' }, redirect: 'manual' });
const html = async (p) => { const res = await get(p); expect(res.status).toBe(200); return res.text(); };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'x-api-key': 'test-key', 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' });
const tok = () => Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ });
const text = (h) => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').replace(/ ([?.!,؟])/g, '$1');
const queueOf = (h) => (h.match(/<section class="card" id="jq">([\s\S]*?)<\/section>/) || [])[1] || '';
const pairs = (q) => [...q.matchAll(/<div class="jq-r">([\s\S]*?)<\/form><\/div>/g)].map((m) => m[1]);

describe('the confirm queue, every switch on, rows from the join-queue service', () => {
  test('the service row\'s first names (first / candidate_first) render in the deck\'s question', async () => {
    await boot();
    const q = queueOf(await html(`/page/${tok()}?tab=jugnu&class=${LIST}`));
    expect(text(q)).toContain('Is Omar the same child as Omar?');
    expect(text(q)).toContain('Is Sara the same child as Sara?');
    expect(q).not.toMatch(/Testwala/);
  });

  test('the father\'s first name under each name; "—" when the record has none; never a surname', async () => {
    await boot();
    const rows = pairs(queueOf(await html(`/page/${tok()}?tab=jugnu&class=${LIST}`)));
    const omar = rows.find((x) => /Omar/.test(x));
    const sara = rows.find((x) => /Sara/.test(x));
    const fathers = (x) => [...x.matchAll(/<span class="jqf">([\s\S]*?)<\/span>/g)].map((m) => text(m[1]).trim());
    expect(fathers(omar)).toEqual(['Javed', 'Tariq']);
    expect(fathers(sara)).toEqual(['—', '—']);
    expect(rows.join('')).not.toMatch(/Testwala/);
  });

  test('EN: the queue\'s words are the deck\'s, byte for byte', async () => {
    await boot();
    const q = queueOf(await html(`/page/${tok()}?tab=jugnu&class=${LIST}`));
    ['Same child', 'Different', 'Not sure', "Link this class's quiz codes to the class list", 'Nothing is ever deleted, and Undo is always here.']
      .forEach((s) => expect(text(q)).toContain(s));
  });

  test('UR: the queue\'s words are the deck\'s, byte for byte (isolates kept)', async () => {
    await boot();
    const q = queueOf(await html(`/page/${tok()}?tab=jugnu&class=${LIST}&lang=ur`));
    ['ایک ہی بچہ', 'الگ الگ ہیں', 'یقین نہیں', 'اس کلاس کے کوئز کوڈ کلاس کی فہرست سے جوڑیں', 'اس سے کبھی کچھ نہیں مٹتا، اور «واپس لیں» ہمیشہ یہیں ہے۔']
      .forEach((s) => expect(text(q)).toContain(s));
    expect(q).toContain('کیا ⁨');
    expect(text(q)).toContain('ایک ہی بچہ ہیں؟');
  });

  test('a tap on the queue is answered (303 back to the tab), not 404', async () => {
    await boot();
    const res = await post(`/queue/${tok()}`, { loose_id: c(2), candidate_id: r(2), decision: 'unsure', class: LIST });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/r/${encodeURIComponent(tok())}?tab=jugnu&class=${LIST}`);
  });

  test('the tab\'s switch off: the queue route is 404 and the service is not asked', async () => {
    await boot({ off: ['web_quiz_teacher_jugnu'] });
    const res = await post(`/queue/${tok()}`, { loose_id: c(2), candidate_id: r(2), decision: 'unsure', class: LIST });
    expect(res.status).toBe(404);
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    expect(h).not.toContain('id="jq"');
  });
});

describe('the forward button needs the class link\'s switch', () => {
  test('a live class_links row and the class link\'s switch on: the button and the 302', async () => {
    await boot();
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    expect(h).toContain('Forward to the class group');
    expect((await get(`/fwd/${tok()}?class=${LIST}`)).status).toBe(302);
  });

  test('a live class_links row but web_quiz_class_link off: no button, the forward route is 404', async () => {
    await boot({ off: ['web_quiz_class_link'] });
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    expect(h).not.toContain('Forward to the class group');
    expect((await get(`/fwd/${tok()}?class=${LIST}`)).status).toBe(404);
  });

  test('the class link\'s parent off (web_quiz_challenge_v2 is the tab\'s parent too): no button', async () => {
    await boot({ off: ['web_quiz_challenge_v2'] });
    expect((await get(`/fwd/${tok()}?class=${LIST}`)).status).toBe(404);
  });
});
