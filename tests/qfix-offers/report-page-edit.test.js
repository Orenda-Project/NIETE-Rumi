'use strict';
/**
 * The teacher edits the quiz in the page the closed-window report opens (/cq, the /cr block), once it is ready.
 * The write path is the bot's quiz edit routes (`/api/internal/wqedit/quiz/:quizId`, `/save`, `/pdf`,
 * quiz-teacher-edit.routes.js); here they are a stub on the bot's HTTP boundary that records what the portal sent and
 * answers in the shapes quiz-teacher-edit.js returns (view / save / ensurePdf). The portal side is real: the
 * coaching-report routes, the page, and the bot's own /api/internal/rq.
 *
 *   - Edit controls per question only when the edit routes answer (their switch on); off → the read-only view.
 *   - The teacher is the signed token's, never the form's.
 *   - The form is diffed against the bot's view: one ops array (text / option per changed slot / key / remove), v = the
 *     edit_v the page was drawn with.
 *   - After the first child answer: wording locked, the right answer still fixable.
 *   - Each refusal (locked, floor, stale, too_long, …) is its own line on the page; each save's outcome is logged.
 */
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';

jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../dashboard/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/storage/r2', () => ({ getPresignedGetUrl: jest.fn().mockResolvedValue('https://r2.example/signed.pdf') }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush() {}, isEnabled: () => true }));
jest.mock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });

const http = require('http');
const express = require('express');
const { makeDb } = require('../quiz/helpers/memory-db');

let mockDb;
const { logEvent: portalEvent } = require('../../dashboard/services/telemetry.service');

const SID = 'a1b2c3d4-1111-4111-8111-000000000001';
const UID = 'b0ffe250-0000-4000-8000-0000000000a1';
const OTHER_UID = 'b0ffe250-0000-4000-8000-0000000000a2';
const QID = 'c0ffe250-0000-4000-8000-0000000000c1';
const ON = { key: 'quiz_offer_closed_window', value: { trace: true, report_page: true } };
const ENV = { ...process.env };
const SENT = { id: QID, coaching_session_id: SID, quiz_source: 'transcript', status: 'sent', teacher_id: UID, topic: 'Adding tens', language: 'en',
  created_at: '2026-11-25T08:00:00Z',
  meta: { step: 'sent', made_via: 'page', delivered_via: 'page', share_code: 'ABC234', share_code_id: 'sc-1',
    student_message: 'Class quiz on Adding tens: https://portal.example/q/ABC234', pdf_key: 'transcript_quizzes/u/q.pdf' } };
const item = (i, extra = {}) => ({
  qid: `11111111-0000-4000-8000-00000000000${i}`, text: `Question ${i + 1}: what is ${i + 1} tens?`, multi: false,
  editable: { text: true, options: true, key: true, remove: true },
  options: [{ slot: 'A', text: `${i + 1}0`, picture: false }, { slot: 'B', text: `${i + 1}`, picture: false }, { slot: 'C', text: `${i + 1}00`, picture: false }],
  key: 'A', ...extra,
});
const VIEW = (over = {}) => {
  const locked = over.locked === true;
  const n = over.questions ? over.questions.length : 8;
  const questions = (over.questions || Array.from({ length: n }, (_, i) => item(i)))
    .map((q) => (locked ? { ...q, editable: { text: false, options: false, key: q.editable.key, remove: false } } : q));
  return { ok: true, quiz_id: QID, language: 'en', edit_v: 3, locked, editable: true, n, min: 5, pdf: 'ready', pdf_key: 'k', ...over, questions };
};

function seed({ language = 'en' } = {}) {
  mockDb = makeDb({
    users: [{ id: UID, name: 'Sadia Noor', phone_number: '923330000011', preferred_language: language }],
    app_settings: [ON],
    coaching_sessions: [{ id: SID, user_id: UID, status: 'completed', observation_type: null, analysis_data: { topic: 'Adding tens' },
      created_at: '2026-11-25T07:00:00Z', users: { id: UID, phone_number: '923330000011', preferred_language: language } }],
    quizzes: [{ ...SENT, meta: { ...SENT.meta } }],
    quiz_questions: [],
  });
}

/** The bot's quiz edit routes, in their real shapes: what the portal sent, and the answer the test chose. */
function fakeEditRoutes() {
  const e1 = { calls: [], view: VIEW(), edit: { status: 200, body: { ok: true, edit_v: 4, n: 8, answered: false, pdf: 'pending' } }, pdf: { status: 200, body: { ok: true, pdf: 'pending' } }, off: false };
  const r = express.Router();
  r.use(express.json());
  r.use((req, res, next) => (req.headers['x-api-key'] === 'k1' ? next() : res.status(401).json({ error: 'Unauthorized' })));
  r.get('/quiz/:quizId', (req, res) => {
    e1.calls.push({ path: 'quiz', quizId: req.params.quizId, t: req.query.t });
    if (e1.off) return res.status(404).json({ off: true });
    if (req.params.quizId !== QID || req.query.t !== UID) return res.status(403).json({ reason: 'not_owner' });
    return res.json(e1.view);
  });
  r.post('/save', (req, res) => {
    e1.calls.push({ path: 'edit', body: req.body });
    if (e1.off) return res.status(404).json({ off: true });
    return res.status(e1.edit.status).json(e1.edit.body);
  });
  r.post('/pdf', async (req, res) => {
    e1.calls.push({ path: 'pdf', body: req.body });
    // ready: the bot has stored the remade PDF's key on the quiz (quiz_teacher_edit_pdf)
    if (e1.pdf.body && e1.pdf.body.pdf === 'ready') {
      const db = require('../../bot/shared/config/supabase');
      const { data } = await db.from('quizzes').select('meta').eq('id', QID).maybeSingle();
      await db.from('quizzes').update({ meta: { ...data.meta, pdf_key: 'transcript_quizzes/u/q-e4.pdf' } }).eq('id', QID);
    }
    return res.status(e1.pdf.status).json(e1.pdf.body);
  });
  return { e1, router: r };
}

let servers = [];
async function listen(app) {
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  servers.push(srv);
  return srv.address().port;
}

async function start() {
  require('../../bot/shared/services/quiz/report-page-quiz')._resetCache();
  const { e1, router } = fakeEditRoutes();
  const bot = express();
  bot.use('/api/internal/rq', require('../../bot/shared/routes/report-quiz-internal.routes'));
  bot.use('/api/internal/wqedit', router);
  process.env.MAIN_BOT_URL = `http://127.0.0.1:${await listen(bot)}`;
  const portal = express();
  // The real portal → bot clients, with a test-machine timeout: a loaded run answers late, not never.
  const { createCoachingReportRouter, createReportQuizClient, createBotCaller } = require('../../dashboard/routes/coaching-report.routes');
  portal.use(createCoachingReportRouter({
    reportQuiz: createReportQuizClient({ timeoutMs: 30000 }),
    callBot: createBotCaller({ timeoutMs: 30000 }),
    groupOf: async () => null,
    deliverySwitch: async () => ({ linkTemplate: null, tipWording: false, timeOnPage: false }),
  }));
  const port = await listen(portal);
  const token = (userId = UID) => require('../../bot/shared/services/coaching/report-link-token').signReportLink({ sessionId: SID, userId });
  const req = (method, path, body) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : new URLSearchParams(body).toString());
    const r = http.request({ host: '127.0.0.1', port, path, method,
      headers: data ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
  return { e1, token, req };
}

const edits = (e1) => e1.calls.filter((c) => c.path === 'edit').map((c) => c.body);
const pageEdits = () => portalEvent.mock.calls.filter((c) => c[0] === 'transcript_quiz.page_edit_result').map((c) => c[1]);
const Q0 = item(0).qid;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, TRANSCRIPT_QUIZ_ENABLED: 'true', INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co',
    WHATSAPP_BOT_NUMBER: '923206281951', WEB_QUIZ_BASE_URL: 'https://portal.example' };
});
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
afterAll(() => { process.env = ENV; });

describe('edit in the page, over the bot\'s quiz edit routes', () => {
  test('ready + edit routes on → every question has an Edit form posting to the page, with its id and the edit_v drawn', async () => {
    seed();
    const { token, req } = await start();
    const t = token();
    const r = await req('GET', `/cq/${t}`);
    expect(r.status).toBe(200);
    expect((r.body.match(new RegExp(`<form method="post" action="/cq/${t}/edit"`, 'g')) || []).length).toBeGreaterThanOrEqual(8);
    expect(r.body).toContain(`name="qid" value="${Q0}"`);
    expect(r.body).toContain('name="v" value="3"');
    expect(r.body).toMatch(/<textarea[^>]*name="text"/);
    expect(r.body).toMatch(/name="opt_A"/);
    expect(r.body).toMatch(/type="radio" name="key" value="A" checked/);
    expect(r.body).toContain('Remove this question');
    // the bar stays: Copy and Send are on screen while editing
    expect(r.body).toMatch(/class="qbar"/);
  });

  test('edit routes off → the read-only view, no Edit', async () => {
    seed();
    const { e1, token, req } = await start();
    e1.off = true;
    const r = await req('GET', `/cq/${token()}`);
    expect(r.status).toBe(200);
    expect(r.body).not.toContain('/edit"');
    expect(r.body).not.toContain('Remove this question');
  });

  test('save: the changed fields only, as one ops array; the teacher is the token\'s, never the form\'s; Saved on the page; logged per field', async () => {
    seed();
    const { e1, token, req } = await start();
    const t = token();
    const it = item(0);
    const r = await req('POST', `/cq/${t}/edit`, {
      surface: 'cq', qid: Q0, v: '3', do: 'save', teacherUserId: OTHER_UID, quizId: 'ffffffff-0000-4000-8000-000000000000',
      text: 'Question 1: how many is one ten?', opt_A: it.options[0].text, opt_B: '11', opt_C: it.options[2].text, key: 'B',
    });
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe(`/cq/${t}?e=saved#q-${Q0}`);
    expect(edits(e1)).toEqual([{
      quizId: QID, teacherUserId: UID, v: 3, surface: 'cq',
      ops: [
        { op: 'text', qid: Q0, text: 'Question 1: how many is one ten?' },
        { op: 'option', qid: Q0, slot: 'B', text: '11' },
        { op: 'key', qid: Q0, slot: 'B' },
      ],
    }]);
    // the bot logs page_edit per saved field; the portal logs the page's outcome once per save
    expect(pageEdits()).toEqual([expect.objectContaining({ outcome: 'saved', fields: 'text,option,key', locked: false, surface: 'cq', quizId: QID })]);
    const page = await req('GET', `/cq/${t}?e=saved`);
    expect(page.body).toContain('Saved. Children who open the quiz now get this version.');
  });

  test('nothing changed → nothing sent, and the page says so', async () => {
    seed();
    const { e1, token, req } = await start();
    const t = token();
    const it = item(0);
    const r = await req('POST', `/cq/${t}/edit`, { surface: 'cq', qid: Q0, v: '3', do: 'save', text: it.text, opt_A: '10', opt_B: '1', opt_C: '100', key: 'A' });
    expect(r.headers.location).toBe(`/cq/${t}?e=none#q-${Q0}`);
    expect(edits(e1)).toHaveLength(0);
  });

  test('locked (a child has answered) → no wording fields, the locked line, and a key fix still goes', async () => {
    seed();
    const { e1, token, req } = await start();
    e1.view = VIEW({ locked: true });
    const t = token();
    const r = await req('GET', `/cq/${t}`);
    expect(r.body).not.toMatch(/<textarea[^>]*name="text"/);
    expect(r.body).not.toMatch(/name="opt_A"/);
    expect(r.body).toMatch(/type="radio" name="key" value="B"/);
    expect(r.body).not.toContain('Remove this question');
    expect(r.body).toContain('Children have started this quiz');
    e1.edit = { status: 200, body: { ok: true, edit_v: 4, n: 8, pdf: 'pending', locked: true } };
    // a wording field smuggled into a locked save is never sent
    await req('POST', `/cq/${t}/edit`, { surface: 'cq', qid: Q0, v: '3', do: 'save', text: 'changed', key: 'C' });
    expect(edits(e1)).toEqual([{ quizId: QID, teacherUserId: UID, v: 3, surface: 'cq', ops: [{ op: 'key', qid: Q0, slot: 'C' }] }]);
    expect(pageEdits()).toEqual([expect.objectContaining({ fields: 'key', locked: true, outcome: 'saved' })]);
  });

  test.each([
    [409, { reason: 'locked' }, 'locked', 'Children have started this quiz'],
    [409, { reason: 'floor' }, 'floor', 'A quiz keeps at least'],
    [409, { reason: 'stale' }, 'stale', 'This quiz changed a moment ago'],
    [400, { reason: 'too_long' }, 'too_long', 'too long'],
    [400, { reason: 'empty' }, 'empty', 'cannot be empty'],
    [400, { reason: 'not_text' }, 'not_text', 'picture'],
    [400, { ok: false, reason: 'no_change' }, 'none', 'Nothing was changed'],
    [502, { ok: false, reason: 'db_unavailable' }, 'failed', 'could not be saved'],
    [503, null, 'failed', 'could not be saved'],
  ])('the bot answers %s %j → the page names it (%s)', async (status, body, code, words) => {
    seed();
    const { e1, token, req } = await start();
    e1.edit = { status, body };
    const t = token();
    const r = await req('POST', `/cq/${t}/edit`, { surface: 'cq', qid: Q0, v: '3', do: 'save', text: 'x y z', opt_A: '10', opt_B: '1', opt_C: '100', key: 'A' });
    expect(r.headers.location).toBe(`/cq/${t}?e=${code}#q-${Q0}`);
    const page = await req('GET', `/cq/${t}?e=${code}`);
    expect(page.body).toContain(words);
    expect(pageEdits()).toEqual([expect.objectContaining({ fields: 'text', outcome: code })]);
  });

  test('remove → one remove op; at the floor the Remove button is not drawn', async () => {
    seed();
    const { e1, token, req } = await start();
    const t = token();
    await req('POST', `/cq/${t}/edit`, { surface: 'cq', qid: Q0, v: '3', do: 'remove' });
    expect(edits(e1)).toEqual([{ quizId: QID, teacherUserId: UID, v: 3, surface: 'cq', ops: [{ op: 'remove', qid: Q0 }] }]);
    e1.view = VIEW({ questions: Array.from({ length: 5 }, (_, i) => item(i)) });
    const r = await req('GET', `/cq/${t}`);
    expect(r.body).not.toContain('Remove this question');
  });

  test('a question id that is not in this quiz, or a slot it does not have → 400, nothing sent', async () => {
    seed();
    const { e1, token, req } = await start();
    const t = token();
    expect((await req('POST', `/cq/${t}/edit`, { surface: 'cq', qid: '99999999-0000-4000-8000-000000000099', v: '3', do: 'remove' })).status).toBe(400);
    expect((await req('POST', `/cq/${t}/edit`, { surface: 'cq', qid: Q0, v: '3', do: 'save', key: 'D' })).status).toBe(400);
    expect(edits(e1)).toHaveLength(0);
  });

  test('a picture option keeps its picture: no text field for it', async () => {
    seed();
    const { e1, token, req } = await start();
    const pic = item(0, { options: [{ slot: 'A', text: '', picture: true }, { slot: 'B', text: '1', picture: false }, { slot: 'C', text: '100', picture: false }] });
    e1.view = VIEW({ questions: [pic, ...Array.from({ length: 7 }, (_, i) => item(i + 1))] });
    const r = await req('GET', `/cq/${token()}`);
    const first = r.body.slice(r.body.indexOf(`id="q-${Q0}"`), r.body.indexOf(`id="q-${item(1).qid}"`));
    expect(first).not.toMatch(/name="opt_A"/);
    expect(first).toMatch(/name="opt_B"/);
  });

  test('Download PDF after an edit (no stored PDF yet) → the bot remakes it: being remade, then the link', async () => {
    seed();
    const { e1, token, req } = await start();
    await require('../../bot/shared/config/supabase').from('quizzes').update({ meta: { ...SENT.meta, pdf_key: null } }).eq('id', QID);
    e1.view = VIEW({ pdf: 'pending' });
    const t = token();
    const page = await req('GET', `/cq/${t}`);
    expect(page.body).toContain(`href="/cq/${t}/pdf"`); // still offered while it is being remade
    const first = await req('GET', `/cq/${t}/pdf`);
    expect(first.status).toBe(303);
    expect(first.headers.location).toBe(`/cq/${t}?e=pdf_pending`);
    expect(e1.calls.filter((c) => c.path === 'pdf').map((c) => c.body)).toEqual([{ quizId: QID, teacherUserId: UID }]);
    expect((await req('GET', `/cq/${t}?e=pdf_pending`)).body).toContain('The PDF is being made again with your changes');
    // remade: the bot stored its key; the page hands the same 1-hour link as for the first PDF
    e1.pdf = { status: 200, body: { ok: true, pdf: 'ready' } };
    const second = await req('GET', `/cq/${t}/pdf`);
    expect(second.status).toBe(302);
    expect(second.headers.location).toBe('https://r2.example/signed.pdf');
    expect(require('../../bot/shared/storage/r2').getPresignedGetUrl).toHaveBeenLastCalledWith('transcript_quizzes/u/q-e4.pdf', 3600);
  });

  test('Urdu: the edit controls in Urdu, the floor in Urdu digits', async () => {
    seed({ language: 'ur' });
    const { e1, token, req } = await start();
    const t = token();
    let r = await req('GET', `/cq/${t}`);
    expect(r.body).toContain('ترمیم کریں');
    expect(r.body).toContain('محفوظ کریں');
    e1.edit = { status: 409, body: { reason: 'floor' } };
    await req('POST', `/cq/${t}/edit`, { surface: 'cq', qid: Q0, v: '3', do: 'remove' });
    r = await req('GET', `/cq/${t}?e=floor`);
    expect(r.body).toContain('۵');
  });

  test('"pick all that apply": checkboxes, and the right answers go as one sorted slot list ("A,C")', async () => {
    seed();
    const { e1, token, req } = await start();
    e1.view = VIEW({ questions: [item(0, { multi: true, key: 'A,B' }), ...Array.from({ length: 7 }, (_, i) => item(i + 1))] });
    const t = token();
    const r = await req('GET', `/cq/${t}`);
    expect(r.body).toMatch(/type="checkbox" name="key" value="A" checked/);
    expect(r.body).toMatch(/type="checkbox" name="key" value="B" checked/);
    expect(r.body).toMatch(/type="checkbox" name="key" value="C" aria/);
    // two boxes ticked: the form repeats the field
    await req('POST', `/cq/${t}/edit`, `surface=cq&qid=${Q0}&v=3&do=save&key=C&key=A`);
    expect(edits(e1)).toEqual([{ quizId: QID, teacherUserId: UID, v: 3, surface: 'cq', ops: [{ op: 'key', qid: Q0, slot: 'A,C' }] }]);
    // a single-answer item never sends two
    expect((await req('POST', `/cq/${t}/edit`, `surface=cq&qid=${item(1).qid}&v=3&do=save&key=B&key=C`)).status).toBe(400);
    expect(edits(e1)).toHaveLength(1);
  });

  test('either switch off → an edit post is 404 and nothing is sent', async () => {
    seed();
    const { e1, token, req } = await start();
    const t = token();
    e1.off = true; // the bot's edit routes off
    expect((await req('POST', `/cq/${t}/edit`, { surface: 'cq', qid: Q0, v: '3', do: 'remove' })).status).toBe(404);
    e1.off = false;
    await require('../../bot/shared/config/supabase').from('app_settings').update({ value: { trace: true } }).eq('key', 'quiz_offer_closed_window');
    const { token: t2, req: req2 } = await start(); // a fresh portal: its switch read is not cached
    expect((await req2('POST', `/cq/${t2()}/edit`, { surface: 'cq', qid: Q0, v: '3', do: 'remove' })).status).toBe(404);
    expect(edits(e1)).toHaveLength(0);
  });

  test('a wording change the item does not allow (not locked) names that, not the lock', async () => {
    seed();
    const { e1, token, req } = await start();
    e1.view = VIEW({ questions: [item(0, { editable: { text: false, options: false, key: true, remove: true } }), ...Array.from({ length: 7 }, (_, i) => item(i + 1))] });
    const t = token();
    const r = await req('POST', `/cq/${t}/edit`, { surface: 'cq', qid: Q0, v: '3', do: 'save', text: 'new words', key: 'A' });
    expect(r.headers.location).toBe(`/cq/${t}?e=not_editable#q-${Q0}`);
    expect(edits(e1)).toHaveLength(0);
  });

  test('a form without the version it was drawn with → 400, nothing sent', async () => {
    seed();
    const { e1, token, req } = await start();
    expect((await req('POST', `/cq/${token()}/edit`, { surface: 'cq', qid: Q0, do: 'remove' })).status).toBe(400);
    expect(edits(e1)).toHaveLength(0);
  });

  test('/cr: the same edit forms, and a save goes back to the report', async () => {
    seed();
    const { e1, token, req } = await start();
    const t = token();
    const r = await req('GET', `/cr/${t}`);
    expect(r.body).toContain(`<form method="post" action="/cq/${t}/edit"`);
    const s = await req('POST', `/cq/${t}/edit`, { surface: 'cr', qid: Q0, v: '3', do: 'save', text: 'new words', opt_A: '10', opt_B: '1', opt_C: '100', key: 'A' });
    expect(s.headers.location).toBe(`/cr/${t}?e=saved#q-${Q0}`);
    expect(edits(e1)).toHaveLength(1);
  });
});
