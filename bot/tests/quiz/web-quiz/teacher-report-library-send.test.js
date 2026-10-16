'use strict';
/**
 * The report for a quiz the teacher SENT but did not make — a library quiz from the teacher home (the video bank's,
 * or another teacher's). The class code is the sender's (`quiz_share_codes.teacher_user_id`), the quiz row is not
 * (`quizzes.teacher_id` is the author's, or none for the bank). Behind `quiz_teacher_home`:
 *   - the sender's /r report, its remind, its class tab and "My quiz reports" count ONLY the sender's own codes;
 *   - the 12 h report to the sender carries its live-report links, and never writes the author's quiz row;
 *   - the author's report is byte-identical (it never counted the sender's code, and still does not).
 * Switch off: every one of these is today's, byte for byte.
 *
 * Run for real: teacher-report.data, the report routes, the report list, the 12 h report job. Faked: Supabase (an
 * in-memory client that applies the filters), WhatsApp, the model, Chromium, the loggers.
 */
jest.mock('../../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendTemplateMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png')),
}));
jest.mock('openai', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../../shared/services/llm-client', () => ({
  withSpendRecording: () => ({ chat: { completions: { create: () => Promise.reject(new Error('no model in test')) } } }),
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const { makeFake } = require('./fake-supabase');
// jest.resetModules() gives every test (and every switch state inside one) a fresh registry and fresh switch caches:
// the boundary fakes are read from the registry the code under test will require.
const WA = () => require('../../../shared/services/whatsapp.service');

const AUTHOR = '11111111-1111-4111-8111-11111111111a';
const SENDER = '11111111-1111-4111-8111-11111111111b';
const STRANGER = '11111111-1111-4111-8111-11111111111c';
const LQ = '22222222-2222-4222-8222-2222222222a1'; // a lesson quiz the author made
const VQ = '22222222-2222-4222-8222-2222222222b1'; // a video-bank quiz nobody "made"
const SC_A = '33333333-3333-4333-8333-3333333333a1'; // the author's own class code
const SC_B = '33333333-3333-4333-8333-3333333333b1'; // the sender's code on the author's quiz
const SC_BV = '33333333-3333-4333-8333-3333333333b2'; // the sender's code on the bank quiz
const SC_BF = '33333333-3333-4333-8333-3333333333b3'; // an invited friend's code: never "holding" the quiz
const SC_X = '33333333-3333-4333-8333-3333333333c1'; // a stranger's invited-friend code on the bank quiz
const LIST_A = 'a0000000-0000-4000-8000-0000000000a3';
const LIST_B = 'a0000000-0000-4000-8000-0000000000b3';
const kidA = (n) => `b0000000-0000-4000-8000-0000000000a${n}`;
const kidB = (n) => `b0000000-0000-4000-8000-0000000000b${n}`;
const BASE = 'https://portal.example.test';
const NOW = Date.parse('2026-10-16T12:00:00Z');
const at = (h) => new Date(NOW - h * 3600000).toISOString();
const GOLDEN = path.join(__dirname, '__golden__', 'teacher-report-library-send.author.json');

const session = (id, scId, quizId, studentId, name, correct, h, extra = {}) => ({
  id, quiz_id: quizId, share_code_id: scId, student_id: studentId, student_name: name, user_id: null, student_class: '3',
  parent_phone: null, status: 'completed', correct_answers: correct, total_questions_answered: 4, mastery_percentage: correct * 25,
  completed_at: at(h), created_at: at(h + 0.1), invited_by_student_id: null, device_ref: `dev-${id}`, ...extra,
});

function seed({ home = true, web = true } = {}) {
  const fake = makeFake({
    app_settings: [
      ...(home === null ? [] : [{ key: 'quiz_teacher_home', value: home ? 'true' : 'false' }]),
      { key: 'teacher_report_teachers', value: JSON.stringify('all') },
      ...(web ? [{ key: 'web_quiz_enabled', value: 'true' }, { key: 'web_quiz_teachers', value: JSON.stringify('all') }] : []),
    ],
    users: [
      { id: AUTHOR, phone_number: '000a', preferred_language: 'en', name: 'Author Testwala' },
      { id: SENDER, phone_number: '000b', preferred_language: 'en', name: 'Sender Testwala' },
      { id: STRANGER, phone_number: '000c', preferred_language: 'en', name: 'Stranger Testwala' },
    ],
    quizzes: [
      { id: LQ, teacher_id: AUTHOR, topic: 'Plants', subject: 'science', grade: '3', language: 'en', quiz_source: 'transcript',
        status: 'sent', list_id: LIST_A, created_at: at(100),
        meta: { share_code_id: SC_A, lesson_date: '2026-10-11', student_message: `Our quiz! Tap: ${BASE}/q/AAAAAA`,
          report_guidance: { muddled: 'the author class muddled roots', board: 'x', check: 'y' } } },
      { id: VQ, teacher_id: null, topic: 'Shapes', subject: 'maths', grade: '3', language: 'en', quiz_source: 'video',
        status: 'ready', video_id: 'v1', list_id: null, created_at: at(900), meta: {} },
    ],
    quiz_share_codes: [
      { id: SC_A, code: 'AAAAAA', quiz_id: LQ, teacher_user_id: AUTHOR, teacher_name: 'A', topic: 'Plants', language: 'en',
        report_sent_at: null, invited_by_student_id: null, active: true, expires_at: null, created_at: at(99) },
      { id: SC_B, code: 'BBBBBB', quiz_id: LQ, teacher_user_id: SENDER, teacher_name: 'B', topic: 'Plants', language: 'en',
        report_sent_at: null, invited_by_student_id: null, active: true, expires_at: null, created_at: at(30) },
      { id: SC_BV, code: 'VVVVVV', quiz_id: VQ, teacher_user_id: SENDER, teacher_name: 'B', topic: 'Shapes', language: 'en',
        report_sent_at: null, invited_by_student_id: null, active: true, expires_at: null, created_at: at(20) },
      { id: SC_BF, code: 'FFFFFF', quiz_id: LQ, teacher_user_id: STRANGER, teacher_name: 'C', topic: 'Plants', language: 'en',
        report_sent_at: null, invited_by_student_id: kidB(1), active: true, expires_at: null, created_at: at(10) },
      { id: SC_X, code: 'XXXXXX', quiz_id: VQ, teacher_user_id: STRANGER, teacher_name: 'C', topic: 'Shapes', language: 'en',
        report_sent_at: null, invited_by_student_id: kidB(2), active: true, expires_at: null, created_at: at(10) },
    ],
    student_lists: [
      { id: LIST_A, user_id: AUTHOR, class_name: '3', section: 'A', is_active: true },
      { id: LIST_B, user_id: SENDER, class_name: '3', section: 'B', is_active: true },
    ],
    students: [
      ...[1, 2, 3].map((r) => ({ id: kidA(r), list_id: LIST_A, roll_number: r, student_name: `Aamir${r} Testwala`, student_name_urdu: null, is_active: true })),
      ...[1, 2, 3].map((r) => ({ id: kidB(r), list_id: LIST_B, roll_number: r, student_name: `Bano${r} Testwala`, student_name_urdu: null, is_active: true })),
    ],
    quiz_sessions: [
      session('a1', SC_A, LQ, kidA(1), 'Aamir1 Testwala', 4, 90),
      session('a2', SC_A, LQ, kidA(2), 'Aamir2 Testwala', 2, 89),
      session('b1', SC_B, LQ, kidB(1), 'Bano1 Testwala', 3, 25),
      session('b2', SC_B, LQ, kidB(2), 'Bano2 Testwala', 1, 24),
      // the sender's own test run never counts
      session('bt', SC_B, LQ, null, 'Sender', 4, 23, { user_id: SENDER, device_ref: null }),
      session('bv1', SC_BV, VQ, kidB(3), 'Bano3 Testwala', 4, 15),
      // a friend invited by the sender's child played on the friend's code: not the sender's class
      session('f1', SC_BF, LQ, 'b0000000-0000-4000-8000-0000000000ff', 'Friend Testwala', 4, 9, { invited_by_student_id: kidB(1) }),
    ],
    quiz_questions: [1, 2].map((n) => ({ id: `q${n}`, quiz_id: LQ, external_id: null, sort_order: n, question_text: `Question ${n}?`,
      option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_option: 'A' })),
    quiz_answers: [
      { session_id: 'a1', question_id: 'q1', is_correct: true, selected_option: 'A' },
      { session_id: 'a2', question_id: 'q1', is_correct: false, selected_option: 'D' },
      { session_id: 'b1', question_id: 'q1', is_correct: false, selected_option: 'B' },
      { session_id: 'b2', question_id: 'q1', is_correct: false, selected_option: 'B' },
    ],
  });
  Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
  return fake;
}

let Data;
let Token;
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  process.env.INTERNAL_API_KEY = 'test-key';
  process.env.WEB_QUIZ_BASE_URL = BASE;
  process.env.VIDEO_REPORT_SEND_CLAIM = 'false';
  process.env.WHATSAPP_BOT_NUMBER = '920000000000';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  Data = require('../../../shared/services/quiz/teacher-report.data');
  Token = require('../../../shared/services/quiz/teacher-report-token');
});

const names = (r) => r.played.map((p) => p.first);

describe('the sender\'s report (quiz_teacher_home on)', () => {
  test('the sender of the author\'s quiz gets its report: their own code\'s children only, their own code and link', async () => {
    seed();
    const r = await Data.quizReport(SENDER, LQ);
    expect(r).not.toBeNull();
    expect(names(r)).toEqual(['Bano1', 'Bano2']); // never Aamir* (the author's class), never the friend, never the test run
    expect(r.summary).toMatchObject({ played: 2, onList: 2, of: 3 });
    expect(r.roster).toMatchObject({ state: 'known', className: '3-B' });
    expect(r.notPlayed.map((k) => k.first)).toEqual(['Bano3']);
    expect(r.quiz).toMatchObject({ id: LQ, topic: 'Plants', code: 'BBBBBB', date: at(30) });
    // the children's link is the sender's code — never the author's forwarded message
    expect(r.quiz.link).toBe(`${BASE}/q/BBBBBB`);
    expect(r.reminder.text).toContain(`${BASE}/q/BBBBBB`);
    expect(r.reminder.text).not.toContain('AAAAAA');
    // the author's class guidance is about the author's class: not shown to the sender
    expect(r.guidance).toBeNull();
    // the questions count the sender's children only
    expect(r.questions[0]).toMatchObject({ answered: 2, correctPct: 0 });
    expect(r.questions[0].wrongTop).toMatchObject({ option: 'B' });
  });

  test('a bank quiz (no author): the sender\'s report from their own code', async () => {
    seed();
    const r = await Data.quizReport(SENDER, VQ);
    expect(r).not.toBeNull();
    expect(names(r)).toEqual(['Bano3']);
    expect(r.quiz).toMatchObject({ code: 'VVVVVV', link: `${BASE}/q/VVVVVV` });
  });

  test('the web quiz off for the sender: the reminder carries today\'s chat join link for their own code', async () => {
    seed({ web: false });
    const r = await Data.quizReport(SENDER, VQ);
    expect(r.quiz.link).toBe('https://wa.me/920000000000?text=QUIZ-VVVVVV');
    expect(r.reminder.text).toContain('QUIZ-VVVVVV');
  });

  test('a teacher holding no class code (only an invited friend\'s) is still refused', async () => {
    seed();
    expect(await Data.quizReport(STRANGER, LQ)).toBeNull();
    expect(await Data.quizReport(STRANGER, VQ)).toBeNull();
  });

  test('the author\'s report is byte-identical to today\'s (golden recorded on the base) and never counts the sender\'s children', async () => {
    seed();
    const r = await Data.quizReport(AUTHOR, LQ);
    expect(names(r)).toEqual(['Aamir1', 'Aamir2']);
    // Recorded once on the base (before this change): RECORD_GOLDEN=1 writes it.
    if (process.env.RECORD_GOLDEN === '1') fs.writeFileSync(GOLDEN, `${JSON.stringify(r)}\n`);
    expect(JSON.stringify(r)).toBe(fs.readFileSync(GOLDEN, 'utf8').trim());
  });

  test('the class tab lists the sender\'s library sends with their own counts; the author\'s is unchanged', async () => {
    seed();
    const b = await Data.classReport(SENDER, { now: NOW });
    const byId = Object.fromEntries(b.quizzes.map((q) => [q.id, q]));
    expect(Object.keys(byId).sort()).toEqual([LQ, VQ].sort());
    expect(byId[LQ]).toMatchObject({ played: 2, onList: 2, of: 3, date: at(30) });
    expect(byId[VQ]).toMatchObject({ played: 1, date: at(20) });
    expect(b.quizzes.map((q) => q.id)).toEqual([VQ, LQ]); // newest send first
    jest.resetModules();
    seed({ home: false });
    const off = await require('../../../shared/services/quiz/teacher-report.data').classReport(AUTHOR, { now: NOW });
    jest.resetModules();
    seed();
    const on = await require('../../../shared/services/quiz/teacher-report.data').classReport(AUTHOR, { now: NOW });
    expect(JSON.stringify(on)).toBe(JSON.stringify(off));
  });
});

describe('switch off: today\'s, byte for byte', () => {
  test.each([['false', false], ['absent', null]])('quiz_teacher_home %s: the sender is refused, the class tab has no library sends', async (_, home) => {
    seed({ home });
    expect(await Data.quizReport(SENDER, LQ)).toBeNull();
    expect(await Data.quizReport(SENDER, VQ)).toBeNull();
    const b = await Data.classReport(SENDER, { now: NOW });
    expect(b.quizzes).toEqual([]);
    expect(JSON.stringify(await Data.quizReport(AUTHOR, LQ))).toBe(fs.readFileSync(GOLDEN, 'utf8').trim());
  });
});

describe('the remind route', () => {
  let server;
  let base;
  const start = async () => {
    const app = express();
    app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
  };
  afterEach(async () => { if (server) await new Promise((r) => server.close(r)); server = null; });
  const get = (p) => fetch(`${base}${p}`, { headers: { 'x-api-key': 'test-key' }, redirect: 'manual' });

  test('on: the sender reminds their own class with their own code\'s link; the page and the data open', async () => {
    seed();
    await start();
    const tok = Token.signTeacherReport({ teacherId: SENDER, quizId: LQ });
    const res = await get(`/remind/${tok}`);
    expect(res.status).toBe(302);
    const to = decodeURIComponent(res.headers.get('location'));
    expect(to).toContain(`${BASE}/q/BBBBBB`);
    expect(to).not.toContain('AAAAAA');
    expect((await get(`/page/${tok}`)).status).toBe(200);
    const data = await (await get(`/data/${tok}`)).json();
    expect(data.report.played.map((p) => p.first)).toEqual(['Bano1', 'Bano2']);
  });

  test('off: the sender\'s remind and page are the 404 they are today', async () => {
    seed({ home: false });
    await start();
    const tok = Token.signTeacherReport({ teacherId: SENDER, quizId: LQ });
    expect((await get(`/remind/${tok}`)).status).toBe(404);
    expect((await get(`/page/${tok}`)).status).toBe(404);
  });
});

describe('"My quiz reports" in chat', () => {
  test('on: the sender\'s list has the library sends, and a tap sends the report link', async () => {
    seed();
    const List = require('../../../shared/services/quiz/teacher-report-list.service');
    await List.showReports({ id: SENDER, preferred_language: 'en' }, '000b', 'en');
    const rows = WA().sendInteractiveMessage.mock.calls[0][1].action.sections[0].rows;
    expect(rows.map((r) => r.id)).toEqual([`tqr_${VQ}`, `tqr_${LQ}`]);
    expect(rows[1].description).toMatch(/2\/3|2 of 3/);
    WA().sendMessage.mockClear();
    expect(await List.handleReportsPick(`tqr_${LQ}`, '000b', { id: SENDER, preferred_language: 'en' })).toBe(true);
    const sent = JSON.stringify([...WA().sendMessage.mock.calls, ...WA().sendTemplateMessage.mock.calls]);
    expect(sent).toContain(`${BASE}/r/`);
  });

  test('off: the sender\'s list is today\'s (empty) and a tap is "not yours"', async () => {
    seed({ home: false });
    const List = require('../../../shared/services/quiz/teacher-report-list.service');
    await List.showReports({ id: SENDER, preferred_language: 'en' }, '000b', 'en');
    expect(WA().sendInteractiveMessage).not.toHaveBeenCalled();
    WA().sendMessage.mockClear();
    await List.handleReportsPick(`tqr_${LQ}`, '000b', { id: SENDER, preferred_language: 'en' });
    expect(JSON.stringify(WA().sendMessage.mock.calls)).not.toContain(`${BASE}/r/`);
  });
});

describe('the 12 h report on the sender\'s code', () => {
  const linksMsg = () => WA().sendMessage.mock.calls.map((c) => String(c[1])).find((t) => t.includes('/r/'));

  test('on: it goes to the sender with the live report and remind links for their own report', async () => {
    seed();
    const report = require('../../../shared/services/quiz/video-quiz-report.service');
    expect(await report.generate(SC_B, { reason: 'scheduled' })).toBe(true);
    expect(WA().sendDocument.mock.calls[0][0]).toBe('000b');
    const msg = linksMsg();
    expect(msg).toBeTruthy();
    const live = (msg.match(new RegExp(`${BASE}/r/([^/\\s]+)(?=\\s|$)`)) || [])[1];
    expect(Token.verifyTeacherReport(live)).toEqual({ teacherId: SENDER, quizId: LQ });
  });

  test('on: the sender\'s report never writes the author\'s quiz row (status, guidance)', async () => {
    const fake = seed();
    const before = JSON.stringify(fake.db.quizzes.find((q) => q.id === LQ));
    const report = require('../../../shared/services/quiz/video-quiz-report.service');
    await report.generate(SC_B, { reason: 'scheduled' });
    expect(JSON.stringify(fake.db.quizzes.find((q) => q.id === LQ))).toBe(before);
    expect(fake.db.quiz_share_codes.find((c) => c.id === SC_B).report_sent_at).toBeTruthy();
  });

  test('off: the sender\'s 12 h report is today\'s — no live links', async () => {
    seed({ home: false });
    const report = require('../../../shared/services/quiz/video-quiz-report.service');
    expect(await report.generate(SC_B, { reason: 'scheduled' })).toBe(true);
    expect(linksMsg()).toBeUndefined();
  });

  test('the author\'s 12 h report is the same switch on and off', async () => {
    const run = async (home) => {
      jest.resetModules();
      jest.clearAllMocks();
      const fake = seed({ home });
      await require('../../../shared/services/quiz/video-quiz-report.service').generate(SC_A, { reason: 'scheduled' });
      const strip = (s) => String(s).replace(/\/r\/[^/\s"]+/g, '/r/<tok>').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<ts>');
      return strip(JSON.stringify({
        m: WA().sendMessage.mock.calls, d: WA().sendDocument.mock.calls.map((c) => [c[0], c[2], c[3]]),
        q: fake.db.quizzes.find((q) => q.id === LQ),
      }));
    };
    expect(await run(true)).toBe(await run(false));
  });
});
