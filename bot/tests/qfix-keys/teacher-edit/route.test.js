'use strict';
/**
 * /api/internal/wqedit through the real mount, router and service: the switch, the internal key, the refusals the
 * save function returns (locked, floor, stale, not_owner) mapped to HTTP, the floor refused at the ROUTE (not only in
 * the page), the PDF remade after a save under a new key and never left stale, and the page_edit events. Supabase is
 * the faked boundary (tables + rpc); the save function itself is proved on sandbox Postgres (outputs sql tests).
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const mockLogEvent = jest.fn();
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: (...a) => mockLogEvent(...a) }));

const mockDb = { tables: {}, rpcCalls: [], rpcReply: {} };
function mockQuery(table) {
  const filters = [];
  const q = {
    select() { return q; },
    eq(c, v) { filters.push((r) => r[c] === v); return q; },
    is(c, v) { filters.push((r) => (r[c] == null) === (v === null)); return q; },
    in(c, vs) { filters.push((r) => vs.includes(r[c])); return q; },
    or(expr) {   // PostgREST "user_id.is.null,user_id.neq.<id>"
      const parts = expr.split(',').map((x) => x.split('.'));
      filters.push((r) => parts.some(([c, op, v]) => (op === 'is' ? r[c] == null : r[c] !== v)));
      return q;
    },
    order() { return q; },
    limit(n) { q._limit = n; return q; },
    rows() { const all = (mockDb.tables[table] || []).filter((r) => filters.every((f) => f(r))); return q._limit ? all.slice(0, q._limit) : all; },
    maybeSingle() { return Promise.resolve({ data: q.rows()[0] || null, error: null }); },
    then(ok, bad) { return Promise.resolve({ data: q.rows(), error: null }).then(ok, bad); },
  };
  return q;
}
jest.mock('../../../shared/config/supabase', () => ({
  from: (t) => mockQuery(t),
  rpc: (name, args) => { mockDb.rpcCalls.push({ name, args }); const r = mockDb.rpcReply[name]; return Promise.resolve(typeof r === 'function' ? r(args) : r); },
}));
const mockRender = jest.fn();
const mockUpload = jest.fn();
jest.mock('../../../shared/storage/r2', () => ({ uploadBuffer: (...a) => mockUpload(...a) }));
jest.mock('../../../shared/services/quiz/transcript-quiz-generate.service', () => ({
  renderPdf: (...a) => mockRender(...a), withFigureSvgs: (rows) => rows,
}));
jest.mock('../../../shared/services/quiz/transcript-quiz-handoff.service', () => ({
  load: async (quizId) => ({
    quiz: { id: quizId, teacher_id: '00000000-0000-4000-8000-00000000aaaa', topic: 'Animals', grade: 2, quiz_source: 'lp_v8' },
    session: { created_at: '2026-11-25T05:00:00Z' }, questions: null, qRows: [], digest: {}, meta: { link: 'https://portal.niete.edu.pk/q/ABC123' },
    language: 'en', teacherLang: 'en', teacherName: 'T',
  }),
}));

// The validator's module graph loads an ES module jest cannot parse; its floor (MIN_QUESTIONS = 6) is the one value used.
jest.mock('../../../shared/services/quiz/transcript-quiz-validator', () => ({ MIN_QUESTIONS: 6 }));

const express = require('express');
const { mountTeacherEdit, MOUNT_PATH } = require('../../../shared/services/first-touch/teacher-edit.mount');
const mounts = require('../../../shared/services/first-touch/mounts');

const QUIZ = '00000000-0000-4000-8000-000000000001';
const TEACHER = '00000000-0000-4000-8000-00000000aaaa';
const OTHER = '00000000-0000-4000-8000-00000000bbbb';
const qid = (i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`;

function seed({ n = 8, switchOn = true } = {}) {
  mockDb.tables = {
    app_settings: switchOn ? [{ key: 'web_quiz_teacher_edit', value: true }] : [],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, language: 'en', meta: { edit_v: 0, pdf_key: 'transcript_quizzes/t/q.pdf' } }],
    quiz_questions: Array.from({ length: n }, (_, i) => ({
      id: qid(i), quiz_id: QUIZ, sort_order: i, question_text: `Q${i}`, option_a: 'a', option_b: 'b', option_c: 'c', option_d: null,
      correct_option: 'A', explanation: null, misconception_feedback: null, distractor_misconceptions: null, option_feedback: null, media: {},
    })),
    quiz_sessions: [],
    quiz_answers: [],
  };
  mockDb.rpcCalls = [];
  mockDb.rpcReply = {
    quiz_teacher_edit_apply: { data: { ok: true, edit_v: 1, n, answered: false, reviews: 0 }, error: null },
    quiz_teacher_edit_pdf: { data: true, error: null },
  };
}

let server;
let base;
beforeAll(async () => {
  const app = express();
  expect(mountTeacherEdit(app)).toBe(true);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}${MOUNT_PATH}`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => { seed(); mockLogEvent.mockClear(); mockRender.mockReset(); mockUpload.mockReset(); mockRender.mockResolvedValue(Buffer.from('%PDF')); });

const post = (path, body, key = process.env.INTERNAL_API_KEY) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (path) => fetch(`${base}${path}`, { headers: { 'x-api-key': process.env.INTERNAL_API_KEY } })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const save = (ops, extra = {}) => post('/save', { quizId: QUIZ, teacherUserId: TEACHER, v: 0, ops, surface: 'cq', ...extra });

test('the mount is one line in the first-touch list, in name order', () => {
  expect(mounts.map(([n]) => n)).toContain('teacher-edit');
});

test('switch off (no app_settings row): 404 {off:true}, nothing written', async () => {
  seed({ switchOn: false });
  const r = await save([{ op: 'text', qid: qid(0), text: 'New words' }]);
  expect(r).toEqual({ status: 404, body: { off: true } });
  expect(mockDb.rpcCalls).toEqual([]);
});

test('without the internal key: 401', async () => {
  const r = await post('/save', { quizId: QUIZ, teacherUserId: TEACHER, ops: [] }, 'wrong');
  expect(r.status).toBe(401);
});

test('a save: the function gets the planned rows and the floor, then the PDF is remade under a NEW key for edit 1', async () => {
  const r = await save([{ op: 'text', qid: qid(2), text: 'New words' }]);
  expect(r).toEqual({ status: 200, body: { ok: true, edit_v: 1, n: 8, answered: false, pdf: 'ready' } });
  const apply = mockDb.rpcCalls.find((c) => c.name === 'quiz_teacher_edit_apply');
  expect(apply.args).toMatchObject({ p_quiz_id: QUIZ, p_teacher_id: TEACHER, p_expect_v: 0, p_min: 6, p_editor: 'teacher' });
  expect(apply.args.p_changes[0].after.question_text).toBe('New words');
  expect(mockUpload).toHaveBeenCalledWith(Buffer.from('%PDF'), `transcript_quizzes/${TEACHER}/${QUIZ}-e1.pdf`, 'application/pdf');
  expect(mockDb.rpcCalls.find((c) => c.name === 'quiz_teacher_edit_pdf').args).toEqual({ p_quiz_id: QUIZ, p_edit_v: 1, p_pdf_key: `transcript_quizzes/${TEACHER}/${QUIZ}-e1.pdf` });
  expect(mockLogEvent).toHaveBeenCalledWith('transcript_quiz.page_edit', expect.objectContaining({ quiz_id: QUIZ, field: 'text', locked: false, surface: 'cq' }));
});

test('the PDF render fails AFTER the save: pdf pending, no pdf_key written (the save already dropped the old one)', async () => {
  mockRender.mockRejectedValue(new Error('chromium died'));
  const r = await save([{ op: 'key', qid: qid(1), slot: 'C' }]);
  expect(r.body).toMatchObject({ ok: true, pdf: 'pending' });
  expect(mockDb.rpcCalls.map((c) => c.name)).toEqual(['quiz_teacher_edit_apply']);
});

test('a later save superseded this PDF: pending, never pointed at by the quiz', async () => {
  mockDb.rpcReply.quiz_teacher_edit_pdf = { data: false, error: null };
  const r = await save([{ op: 'key', qid: qid(1), slot: 'C' }]);
  expect(r.body.pdf).toBe('pending');
});

test.each([
  ['locked', 409], ['floor', 409], ['stale', 409], ['not_owner', 403],
])('the save function refuses %s → %i, no PDF remade', async (reason, status) => {
  mockDb.rpcReply.quiz_teacher_edit_apply = { data: { ok: false, reason, qid: qid(0) }, error: null };
  const r = await save([{ op: 'text', qid: qid(0), text: 'x y' }]);
  expect(r.status).toBe(status);
  expect(r.body).toMatchObject({ ok: false, reason });
  expect(mockRender).not.toHaveBeenCalled();
});

test('locked is logged as page_edit {locked:true} for each field tried', async () => {
  mockDb.rpcReply.quiz_teacher_edit_apply = { data: { ok: false, reason: 'locked', qid: qid(0) }, error: null };
  await save([{ op: 'text', qid: qid(0), text: 'x y' }, { op: 'option', qid: qid(0), slot: 'B', text: 'bee' }], { surface: 'cr' });
  expect(mockLogEvent.mock.calls.filter(([e]) => e === 'transcript_quiz.page_edit').map(([, d]) => [d.field, d.locked, d.surface]))
    .toEqual([['text', true, 'cr'], ['option_b', true, 'cr']]);
});

test('the floor is refused at the route: removing 3 of 8 asks the function for p_min 6, and its floor refusal is a 409', async () => {
  mockDb.rpcReply.quiz_teacher_edit_apply = (args) => {
    const removes = args.p_changes.filter((c) => c.remove).length;
    return { data: 8 - removes < args.p_min ? { ok: false, reason: 'floor', n: 8, min: args.p_min } : { ok: true, edit_v: 1, n: 8 - removes }, error: null };
  };
  const r = await save([0, 1, 3].map((i) => ({ op: 'remove', qid: qid(i) })));
  expect(r).toEqual({ status: 409, body: { ok: false, reason: 'floor', min: 6 } });
  const ok = await save([0, 1].map((i) => ({ op: 'remove', qid: qid(i) })));
  expect(ok.body).toMatchObject({ ok: true, n: 6 });
});

test('more than 40 ops in one save: refused at the route, the save function never called', async () => {
  const r = await save(Array.from({ length: 41 }, (_, i) => ({ op: 'text', qid: qid(i % 8), text: `w${i}` })));
  expect(r).toEqual({ status: 400, body: { ok: false, reason: 'bad_request' } });
  expect(mockDb.rpcCalls).toEqual([]);
});

test('a bad op is refused before the save function is called', async () => {
  const r = await save([{ op: 'key', qid: qid(0), slot: 'D' }]);
  expect(r).toEqual({ status: 400, body: { ok: false, reason: 'bad_slot', qid: qid(0) } });
  expect(mockDb.rpcCalls).toEqual([]);
});

test('the view: every question with its key; another teacher gets 403; a child answer marks it locked', async () => {
  const v = await get(`/quiz/${QUIZ}?t=${TEACHER}`);
  expect(v.status).toBe(200);
  expect(v.body).toMatchObject({ ok: true, edit_v: 0, locked: false, n: 8, min: 6, pdf: 'ready' });
  expect(v.body.questions[0]).toMatchObject({ qid: qid(0), text: 'Q0', key: 'A', editable: { text: true, options: true, key: true, remove: true } });
  expect((await get(`/quiz/${QUIZ}?t=${OTHER}`)).status).toBe(403);
  mockDb.tables.quiz_sessions = [{ id: 's-teacher', quiz_id: QUIZ, user_id: TEACHER }, { id: 's-kid', quiz_id: QUIZ, user_id: null }];
  mockDb.tables.quiz_answers = [{ id: 'a1', session_id: 's-teacher' }];
  expect((await get(`/quiz/${QUIZ}?t=${TEACHER}`)).body.locked).toBe(false);   // the teacher's own preview never locks it
  mockDb.tables.quiz_sessions.push({ id: 's-other', quiz_id: QUIZ, user_id: OTHER });
  mockDb.tables.quiz_answers.push({ id: 'a3', session_id: 's-other' });
  expect((await get(`/quiz/${QUIZ}?t=${TEACHER}`)).body.locked).toBe(true);   // anyone but the quiz's teacher counts
  mockDb.tables.quiz_answers.pop();
  expect((await get(`/quiz/${QUIZ}?t=${TEACHER}`)).body.locked).toBe(false);
  mockDb.tables.quiz_answers.push({ id: 'a2', session_id: 's-kid' });
  const locked = await get(`/quiz/${QUIZ}?t=${TEACHER}`);
  expect(locked.body.locked).toBe(true);
  expect(locked.body.questions[0].editable).toEqual({ text: false, options: false, key: true, remove: false });
});

test('POST /pdf: a quiz with no PDF has it remade for its current version', async () => {
  mockDb.tables.quizzes[0].meta = { edit_v: 3 };
  const r = await post('/pdf', { quizId: QUIZ, teacherUserId: TEACHER });
  expect(r.body).toEqual({ ok: true, pdf: 'ready' });
  expect(mockUpload.mock.calls[0][1]).toBe(`transcript_quizzes/${TEACHER}/${QUIZ}-e3.pdf`);
  expect((await post('/pdf', { quizId: QUIZ, teacherUserId: OTHER })).status).toBe(403);
});

test('the response carries no link or share text: /cq\'s token never rides out of the write path', async () => {
  const r = await save([{ op: 'text', qid: qid(2), text: 'New words' }]);
  expect(JSON.stringify(r.body)).not.toMatch(/https?:|\/cq\/|\/q\//);
});
