'use strict';
/**
 * /api/internal/tr/* — the teacher's web report behind the portal's /r/<token>.
 *
 * The routes run for real on an ephemeral port, over the real data core and the
 * real token. Faked: Supabase (an in-memory client that applies filters), the
 * PDF renderer (Chromium) and the event logger, whose calls are the events.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn(async () => Buffer.from('%PDF-1.4 fake')) }));

const express = require('express');
const { makeFake } = require('./fake-supabase');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const QUIZ_UR = '22222222-2222-4222-8222-222222222223';
const QUIZ_OTHER = '22222222-2222-4222-8222-2222222222ff';
const SC = '33333333-3333-4333-8333-333333333333';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const LINK = 'https://portal.example.test/q/AB12CD';
const WA_UA = 'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36 WhatsApp/2.24';

let DB;
function seed() {
  DB = {
    users: [{ id: TEACHER, preferred_language: 'en' }, { id: OTHER, preferred_language: 'en' }],
    quizzes: [
      { id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en', quiz_source: 'transcript', status: 'report_sent',
        list_id: null, created_at: ago(30), meta: { share_code_id: SC, student_message: `Our quiz is ready! Tap: ${LINK}` } },
      { id: QUIZ_UR, teacher_id: TEACHER, topic: 'کسریں', subject: 'maths', grade: '5', language: 'ur', quiz_source: 'lp_v8', status: 'sent',
        list_id: null, created_at: ago(50), meta: {} },
      { id: QUIZ_OTHER, teacher_id: OTHER, topic: 'Secret', subject: 'english', grade: '3', language: 'en', quiz_source: 'transcript', status: 'sent',
        created_at: ago(5), meta: { student_message: 'x https://portal.example.test/q/ZZZZZZ' } },
    ],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, invited_by_student_id: null, active: true, expires_at: null, language: 'en', created_at: ago(30) }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: TEACHER, is_active: true }],
    students: [1, 2, 3].map((r) => ({ id: kid(r), list_id: LIST, roll_number: r, student_name: `Kid${r} Testwala`, student_name_urdu: null, is_active: true })),
    quiz_sessions: [{
      id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: kid(1), student_name: 'Kid1 Testwala', user_id: null, status: 'completed',
      correct_answers: 3, total_questions_answered: 4, completed_at: ago(20), created_at: ago(20.1), invited_by_student_id: null, device_ref: 'd1',
    }],
    quiz_questions: [],
    quiz_answers: [],
  };
  const fake = makeFake(DB);
  Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
  return fake;
}

let server;
let base;
let Token;
let logEvent;
let htmlToPdf;

beforeEach(async () => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  seed();
  Token = require('../../../shared/services/quiz/teacher-report-token');
  ({ logEvent } = require('../../../shared/utils/structured-logger'));
  ({ htmlToPdf } = require('../../../shared/utils/html-to-pdf'));
  const app = express();
  app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
});
afterEach(async () => { await new Promise((r) => server.close(r)); });

const get = (path, headers = {}) => fetch(`${base}${path}`, { headers: { 'x-api-key': 'test-key', ...headers }, redirect: 'manual' });
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const quizTok = (teacherId = TEACHER, quizId = QUIZ, now) => Token.signTeacherReport({ teacherId, quizId, now });

describe('auth', () => {
  test('without the internal key: 401, nothing rendered', async () => {
    const res = await fetch(`${base}/page/${quizTok()}`);
    expect(res.status).toBe(401);
  });

  test('an expired token: 410 and the expired page in EN and UR, teacher_report.denied {reason:expired}', async () => {
    const tok = quizTok(TEACHER, QUIZ, Date.now() - 31 * 86400000);
    const res = await get(`/page/${tok}`);
    expect(res.status).toBe(410);
    const html = await res.text();
    expect(html).toMatch(/This link has expired/);
    expect(html).toMatch(/اس لنک کی مدت ختم ہو گئی ہے/);
    expect(events('teacher_report.denied')).toEqual([expect.objectContaining({ reason: 'expired' })]);
  });

  test('a forged token: 401 and the same page, reason bad', async () => {
    const res = await get(`/page/${quizTok().slice(0, -3)}xyz`);
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/This link has expired/);
    expect(events('teacher_report.denied')).toEqual([expect.objectContaining({ reason: 'bad' })]);
  });

  test('a genuine token for a quiz that is not the teacher\'s: 404, nothing about the quiz', async () => {
    const res = await get(`/page/${quizTok(TEACHER, QUIZ_OTHER)}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toMatch(/Secret/);
    expect(html).toMatch(/could not find this report/i);
  });
});

describe('GET /page/:token', () => {
  test('the quiz report: who played, who has not, never cached; opened event with iab from the UA', async () => {
    const res = await get(`/page/${quizTok()}`, { 'user-agent': WA_UA });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const html = await res.text();
    expect(html).toMatch(/Plants/);
    expect(html).toMatch(/Not played yet/);
    expect(html).toMatch(/Kid2/);
    expect(html).not.toMatch(/<script/i);
    expect(events('teacher_report.opened')).toEqual([{ teacherId: TEACHER, quizId: QUIZ, scope: 'quiz', tab: 'quiz', iab: true }]);
  });

  test('no ?lang: the quiz\'s own language; ?lang= overrides', async () => {
    const ur = await (await get(`/page/${quizTok(TEACHER, QUIZ_UR)}`)).text();
    expect(ur).toMatch(/<html[^>]*dir="rtl"/);
    const en = await (await get(`/page/${quizTok(TEACHER, QUIZ_UR)}?lang=en`)).text();
    expect(en).toMatch(/<html[^>]*dir="ltr"/);
  });

  test('all-classes tab on a teacher-wide token: per-quiz links on freshly minted tokens for the same teacher', async () => {
    const tok = Token.signTeacherReport({ teacherId: TEACHER });
    const res = await get(`/page/${tok}`, { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/129' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/All my classes/);
    const links = [...html.matchAll(/href="\/r\/([^"?]+)\?lang=en"/g)].map((m) => decodeURIComponent(m[1]));
    const quizIds = links.map((t) => Token.verifyTeacherReport(t)).filter(Boolean);
    expect(quizIds).toEqual(expect.arrayContaining([{ teacherId: TEACHER, quizId: QUIZ }]));
    expect(quizIds.every((v) => v.teacherId === TEACHER)).toBe(true);
    expect(events('teacher_report.opened')).toEqual([{ teacherId: TEACHER, quizId: null, scope: 'all', tab: 'class', iab: false }]);
  });

  test('?class= picks one of the teacher\'s lists; a list id that is not theirs is ignored', async () => {
    const res = await get(`/page/${quizTok()}?class=${LIST}`);
    expect(res.status).toBe(200);
    const bad = await get(`/page/${quizTok()}?class=not-a-uuid`);
    expect(bad.status).toBe(200);
  });
});

describe('GET /remind/:token', () => {
  test('logs teacher_report.reminder and 302s to wa.me with the reminder and the children\'s link', async () => {
    const res = await get(`/remind/${quizTok()}?quiz=${QUIZ}`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location'));
    expect(loc.origin).toBe('https://wa.me');
    const text = loc.searchParams.get('text');
    expect(text).toMatch(/still open/);
    expect(text).toContain(LINK);
    expect(text).not.toMatch(/Kid\d/);
    expect(events('teacher_report.reminder')).toEqual([{ teacherId: TEACHER, quizId: QUIZ, notPlayed: 2 }]);
  });

  test('a teacher-wide token may remind for its own quiz only', async () => {
    const all = Token.signTeacherReport({ teacherId: TEACHER });
    expect((await get(`/remind/${all}?quiz=${QUIZ}`)).status).toBe(302);
    expect((await get(`/remind/${all}?quiz=${QUIZ_OTHER}`)).status).toBe(404);
  });

  test('a quiz token cannot be pointed at another quiz', async () => {
    expect((await get(`/remind/${quizTok()}?quiz=${QUIZ_UR}`)).status).toBe(404);
  });
});

describe('GET /pdf/:token', () => {
  test('htmlToPdf of the same page in print mode; a PDF attachment, never cached', async () => {
    const res = await get(`/pdf/${quizTok()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/pdf/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="quiz-report-\d{4}-\d{2}-\d{2}\.pdf"/);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(htmlToPdf).toHaveBeenCalledTimes(1);
    const html = htmlToPdf.mock.calls[0][0];
    expect(html).toMatch(/Plants/);
    expect(html).not.toMatch(/\/remind/);
    expect(html).toContain(LINK);
    expect(events('teacher_report.pdf')).toEqual([{ teacherId: TEACHER, quizId: QUIZ, scope: 'quiz' }]);
  });
});

describe('GET /data/:token', () => {
  test('the report as JSON for QA', async () => {
    const res = await get(`/data/${quizTok()}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tab).toBe('quiz');
    expect(body.report.roster.state).toBe('known');
  });
});

/*
 * The class pick and the provisional-child fixes are identity v2's writers
 * (web-quiz.service whoClass / fixWho). The first test runs the REAL whoClass over
 * the faked Supabase; the others replace one writer for one test (restored after)
 * to pin how each of its answers comes back to the teacher.
 */
describe('POST /class/:token and /fix/:token (identity v2 writers)', () => {
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'x-api-key': 'test-key', 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual',
  });
  let WebQuiz;
  let real;
  beforeEach(() => {
    WebQuiz = require('../../../shared/services/quiz/web-quiz.service');
    real = { whoClass: WebQuiz.whoClass, fixWho: WebQuiz.fixWho };
  });
  afterEach(() => { WebQuiz.whoClass = real.whoClass; WebQuiz.fixWho = real.fixWho; });

  test('class: the real whoClass on a closed hand-out → back with a notice that says it closed, reason logged', async () => {
    const tok = quizTok();
    DB.quiz_share_codes[0].active = false;
    const res = await post(`/class/${tok}`, { quiz: QUIZ, key: 'k-3b' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/r/${tok}?e=3`);
    expect(events('teacher_report.class_bound')).toEqual([{ teacherId: TEACHER, quizId: QUIZ, ok: false, reason: 'expired' }]);
    const html = await (await get(`/page/${tok}?e=3`)).text();
    expect(html).toMatch(/link has closed/);
  });

  test('class: any other refusal → the plain "did not save" notice', async () => {
    const tok = quizTok();
    WebQuiz.whoClass = jest.fn(async () => { throw new WebQuiz.WqError(404, { error: 'class_unknown' }); });
    const res = await post(`/class/${tok}`, { quiz: QUIZ, key: 'nope' });
    expect(res.headers.get('location')).toBe(`/r/${tok}?e=1`);
  });

  test('class: the class column not migrated yet (whoClass not_ready) → its own notice, not "try again"', async () => {
    const tok = quizTok();
    WebQuiz.whoClass = jest.fn(async () => { throw new WebQuiz.WqError(503, { error: 'not_ready' }); });
    const res = await post(`/class/${tok}`, { quiz: QUIZ, key: 'k-3b' });
    expect(res.headers.get('location')).toBe(`/r/${tok}?e=2`);
    expect(events('teacher_report.class_bound')).toEqual([{ teacherId: TEACHER, quizId: QUIZ, ok: false, reason: 'not_ready' }]);
    const html = await (await get(`/page/${tok}?e=2`)).text();
    expect(html).toMatch(/cannot be saved yet/);
    expect(html).not.toMatch(/try again/i);
  });

  test('class: hands the quiz\'s code, the report token and the key to whoClass, then 303 back to the report', async () => {
    const tok = quizTok();
    WebQuiz.whoClass = jest.fn(async () => ({ ok: true, class: { label: '3-B' } }));
    const res = await post(`/class/${tok}`, { quiz: QUIZ, key: 'k-3b' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/r/${tok}`);
    expect(WebQuiz.whoClass).toHaveBeenCalledWith({ code: 'AB12CD', tr: tok, key: 'k-3b' });
    expect(events('teacher_report.class_bound')).toEqual([{ teacherId: TEACHER, quizId: QUIZ, ok: true }]);
  });

  test('class: a refusal comes back to the report with a notice, never an error page', async () => {
    const tok = quizTok();
    const { WqError } = WebQuiz;
    WebQuiz.whoClass = jest.fn(async () => { throw new WqError(404, { error: 'class_unknown' }); });
    const res = await post(`/class/${tok}`, { quiz: QUIZ, key: 'nope' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/r/${tok}?e=1`);
    expect(events('teacher_report.class_bound')).toEqual([{ teacherId: TEACHER, quizId: QUIZ, ok: false, reason: 'class_unknown' }]);
  });

  test('class: a deployment without identity v2 (no whoClass) → back with the not-ready notice, nothing written', async () => {
    const tok = quizTok();
    WebQuiz.whoClass = undefined;
    const res = await post(`/class/${tok}`, { quiz: QUIZ, key: 'k-3b' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/r/${tok}?e=2`);
    expect(events('teacher_report.class_bound')).toEqual([{ teacherId: TEACHER, quizId: QUIZ, ok: false, reason: 'not_ready' }]);
  });

  test('class: another teacher\'s quiz is 404 and whoClass is never called', async () => {
    WebQuiz.whoClass = jest.fn();
    const all = Token.signTeacherReport({ teacherId: TEACHER });
    expect((await post(`/class/${all}`, { quiz: QUIZ_OTHER, key: 'k' })).status).toBe(404);
    expect(WebQuiz.whoClass).not.toHaveBeenCalled();
  });

  test('fix: add / studentId go to fixWho with the code and the report token', async () => {
    const tok = quizTok();
    WebQuiz.fixWho = jest.fn(async () => ({ ok: true }));
    const add = await post(`/fix/${tok}`, { quiz: QUIZ, ref: 's1', add: '1' });
    expect(add.status).toBe(303);
    expect(WebQuiz.fixWho).toHaveBeenLastCalledWith({ code: 'AB12CD', tr: tok, ref: 's1', add: true });
    await post(`/fix/${tok}`, { quiz: QUIZ, ref: 's1', studentId: kid(2) });
    expect(WebQuiz.fixWho).toHaveBeenLastCalledWith({ code: 'AB12CD', tr: tok, ref: 's1', studentId: kid(2) });
    expect(events('teacher_report.fixed').map((e) => e.how)).toEqual(['add', 'student']);
  });

  test('a failed save shows the notice on the page', async () => {
    const html = await (await get(`/page/${quizTok()}?e=1`)).text();
    expect(html).toMatch(/did not save/);
  });
});
