'use strict';
/**
 * "My quiz reports" (W37 M3a, SPEC §1.2) and the report link (§1.3).
 *
 * The real list, link and data-core code runs; only supabase and
 * whatsapp.service are mocked (plus the event sink, to read the events).
 */

process.env.WEB_QUIZ_TOKEN_SECRET = 'test-secret-for-teacher-report';
process.env.WEB_QUIZ_BASE_URL = 'https://portal.example';

const { fakeDb } = require('./fake-db');

const T = { id: 'teacher-1', phone_number: '923000000001', preferred_language: 'en' };
const FROM = T.phone_number;

let mockDb;
jest.mock('../../../shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
const mockSent = [];
let mockTemplateOk = true;
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, text) => { mockSent.push({ kind: 'text', to, text }); return true; }),
  sendInteractiveButtons: jest.fn(async (to, p) => { mockSent.push({ kind: 'buttons', to, p }); return true; }),
  sendInteractiveMessage: jest.fn(async (to, p) => { mockSent.push({ kind: 'list', to, p }); return true; }),
  sendFlow: jest.fn(async (to, f) => { mockSent.push({ kind: 'flow', to, f }); return true; }),
  sendTemplate: jest.fn(async (to, name, lang, components) => {
    mockSent.push({ kind: 'template', to, name, lang, components });
    return mockTemplateOk;
  }),
}));
const mockEvents = [];
jest.mock('../../../shared/utils/structured-logger', () => ({
  ...jest.requireActual('../../../shared/utils/structured-logger'),
  logEvent: jest.fn((name, props) => { mockEvents.push({ name, props }); }),
}));

const ReportList = require('../../../shared/services/quiz/teacher-report-list.service');
const Settings = require('../../../shared/services/quiz/teacher-report-gate');
const Token = require('../../../shared/services/quiz/teacher-report-token');

const cp = (s) => [...String(s)].length;
const day = (n) => `2026-10-${String(n).padStart(2, '0')}T08:00:00Z`;

function quiz(id, n, extra = {}) {
  return {
    id, teacher_id: T.id, topic: `Topic ${id}`, subject: 'Science', grade: '5', language: 'en',
    quiz_source: 'transcript', status: 'sent', list_id: null, meta: {}, created_at: day(n), ...extra,
  };
}

function session(id, code, studentId, correct, total, status = 'completed') {
  return {
    id, quiz_id: null, share_code_id: code, student_id: studentId, student_name: `Kid${studentId} Testwala`, user_id: null,
    status, correct_answers: correct, total_questions_answered: total, completed_at: day(5), created_at: day(5),
    invited_by_student_id: null, device_ref: null,
  };
}

function world({ quizzes, codes = [], sessions = [], lists = [], kids = [], settings = { teacher_report_teachers: 'all' } }) {
  mockDb = fakeDb({
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    quizzes,
    quiz_share_codes: codes,
    quiz_sessions: sessions,
    student_lists: lists,
    students: kids,
  });
}

const listMsg = () => mockSent.find((s) => s.kind === 'list');
const rowsOf = () => listMsg().p.action.sections[0].rows;

beforeEach(() => {
  mockSent.length = 0;
  mockEvents.length = 0;
  mockTemplateOk = true;
  Settings._resetCache();
});

describe('the reports list rows', () => {
  const lists = [{ id: 'L5', user_id: T.id, is_active: true, class_name: '5', section: 'A' }];
  const kids = [1, 2, 3, 4].map((i) => ({ id: `k${i}`, list_id: 'L5', is_active: true, roll_number: i, student_name: `K${i}` }));

  test('a quiz with a known class: "topic · played/of played · avg %"', async () => {
    world({
      quizzes: [quiz('qA', 3)],
      codes: [{ id: 'cA', code: 'AAAAAA', quiz_id: 'qA', teacher_user_id: T.id, invited_by_student_id: null }],
      sessions: [session('s1', 'cA', 'k1', 8, 8), session('s2', 'cA', 'k2', 4, 8), session('s3', 'cA', 'k3', 2, 8, 'in_progress')],
      lists, kids,
    });
    await ReportList.showReports(T, FROM, 'en', 1);
    const [row] = rowsOf();
    expect(row.id).toBe('tqr_qA');
    expect(row.description).toBe('Topic qA · 2/4 played · avg 75%');
  });

  test('no class list: "topic · N played · avg %"; nobody yet: "topic · no one yet"', async () => {
    world({
      quizzes: [quiz('qA', 3), quiz('qB', 2)],
      codes: [{ id: 'cA', code: 'AAAAAA', quiz_id: 'qA', teacher_user_id: T.id, invited_by_student_id: null }],
      sessions: [session('s1', 'cA', 'k1', 6, 8)],
    });
    await ReportList.showReports(T, FROM, 'en', 1);
    const rows = rowsOf();
    expect(rows.map((r) => r.description)).toEqual(['Topic qA · 1 played · avg 75%', 'Topic qB · no one yet']);
  });

  test.each(['en', 'ur'])('%s: every row ≤24 cp title, ≤72 cp description, and a long topic never pushes the counts out', async (lang) => {
    const long = lang === 'ur'
      ? 'پودوں میں ضیائی تالیف اور سورج کی روشنی سے خوراک بننے کا مکمل عمل اور اس کے مراحل'
      : 'Photosynthesis and how green plants make their own food from sunlight, water and air';
    world({
      quizzes: [quiz('qA', 3, { topic: long, language: lang, subject: 'General Science' })],
      codes: [{ id: 'cA', code: 'AAAAAA', quiz_id: 'qA', teacher_user_id: T.id, invited_by_student_id: null }],
      sessions: [session('s1', 'cA', 'k1', 8, 8)],
      lists, kids,
    });
    await ReportList.showReports({ ...T, preferred_language: lang }, FROM, lang, 1);
    const p = listMsg().p;
    rowsOf().forEach((r) => {
      expect(cp(r.title)).toBeLessThanOrEqual(24);
      expect(cp(r.description)).toBeLessThanOrEqual(72);
      expect(r.description).toMatch(/1\/4/);
      expect(r.description).toMatch(/100%/);
    });
    expect(cp(p.action.button)).toBeLessThanOrEqual(20);
    expect(cp(p.header.text)).toBeLessThanOrEqual(60);
    expect(cp(p.action.sections[0].title)).toBeLessThanOrEqual(24);
  });

  test('12 sent quizzes: 9 rows + tqr_page_2; one batched read per table, never one per quiz', async () => {
    const quizzes = Array.from({ length: 12 }, (_, i) => quiz(`q${i + 1}`, i + 1));
    const codes = quizzes.map((q) => ({ id: `c${q.id}`, code: q.id, quiz_id: q.id, teacher_user_id: T.id, invited_by_student_id: null }));
    world({ quizzes, codes, sessions: [session('s1', 'cq12', 'k1', 8, 8)], lists, kids });
    await ReportList.showReports(T, FROM, 'en', 1);
    const rows = rowsOf();
    expect(rows).toHaveLength(10);
    expect(rows[0].id).toBe('tqr_q12');
    expect(rows[9].id).toBe('tqr_page_2');
    const reads = (t) => mockDb.reads.filter((r) => r.table === t).length;
    expect(reads('quiz_sessions')).toBe(1);
    expect(reads('quiz_share_codes')).toBe(1);
    expect(reads('quizzes')).toBe(1);
    expect(reads('student_lists')).toBe(1);

    mockSent.length = 0;
    expect(await ReportList.handleReportsPick('tqr_page_2', FROM, T)).toBe(true);
    expect(rowsOf().map((r) => r.id)).toEqual(['tqr_q3', 'tqr_q2', 'tqr_q1']);
  });

  test('no sent quiz: one plain line, no empty list', async () => {
    world({ quizzes: [quiz('qA', 3, { status: 'generating' })] });
    await ReportList.showReports(T, FROM, 'en', 1);
    expect(mockSent.map((s) => s.kind)).toEqual(['text']);
  });
});

describe('a tapped report row sends that quiz\'s report link', () => {
  test('text transport (no template setting): the report link for this teacher and quiz', async () => {
    world({ quizzes: [quiz('qA', 3)] });
    expect(await ReportList.handleReportsPick('tqr_qA', FROM, T)).toBe(true);
    const msg = mockSent.find((s) => s.kind === 'text');
    const m = msg.text.match(/https:\/\/portal\.example\/[tr]\/(\S+)/);
    expect(m).toBeTruthy();
    expect(Token.verifyTeacherReport(decodeURIComponent(m[1]))).toEqual({ teacherId: T.id, quizId: 'qA' });
    expect(msg.text).toMatch(/Topic qA/);
    const ev = mockEvents.find((e) => e.name === 'teacher_report.link_sent');
    expect(ev.props).toEqual({ userId: T.id, quizId: 'qA', scope: 'q', how: 'text' });
  });

  test('template transport: body {{1}} = topic, URL button index 0 = the token', async () => {
    world({ quizzes: [quiz('qA', 3)], settings: { teacher_report_teachers: 'all', teacher_report_template: 'quiz_teacher_report_v1' } });
    await ReportList.handleReportsPick('tqr_qA', FROM, T);
    const t = mockSent.find((s) => s.kind === 'template');
    expect(t.name).toBe('quiz_teacher_report_v1');
    expect(t.lang).toBe('en');
    const body = t.components.find((c) => c.type === 'body');
    expect(body.parameters).toEqual([{ type: 'text', text: 'Topic qA' }]);
    const btn = t.components.find((c) => c.type === 'button');
    expect(btn).toMatchObject({ sub_type: 'url', index: '0' });
    expect(Token.verifyTeacherReport(btn.parameters[0].text)).toEqual({ teacherId: T.id, quizId: 'qA' });
    expect(mockSent.some((s) => s.kind === 'text')).toBe(false);
    expect(mockEvents.find((e) => e.name === 'teacher_report.link_sent').props.how).toBe('template');
  });

  test('a template WhatsApp refuses → the text link instead (never silence)', async () => {
    world({ quizzes: [quiz('qA', 3)], settings: { teacher_report_teachers: 'all', teacher_report_template: 'quiz_teacher_report_v1' } });
    mockTemplateOk = false;
    await ReportList.handleReportsPick('tqr_qA', FROM, T);
    expect(mockSent.map((s) => s.kind)).toEqual(['template', 'text']);
    expect(mockEvents.find((e) => e.name === 'teacher_report.link_sent').props.how).toBe('text');
  });

  test('another teacher\'s quiz id → "not found", no link', async () => {
    world({ quizzes: [quiz('qX', 3, { teacher_id: 'someone-else' })] });
    await ReportList.handleReportsPick('tqr_qX', FROM, T);
    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].text).not.toMatch(/\/t\//);
  });

  test('an id the list does not own is not handled', async () => {
    world({ quizzes: [] });
    expect(await ReportList.handleReportsPick('tq_pick_abc', FROM, T)).toBe(false);
  });
});

describe('Class progress (tqh_class) sends the all-classes link', () => {
  const Home = require('../../../shared/services/quiz/teacher-quiz-home.service');

  test.each(['en', 'ur'])('%s: scope * token, the "all your classes" topic', async (lang) => {
    world({ quizzes: [] });
    await Home.handleHomeButton('tqh_class', FROM, { ...T, preferred_language: lang });
    const msg = mockSent.find((s) => s.kind === 'text');
    const m = msg.text.match(/https:\/\/portal\.example\/[tr]\/(\S+)/);
    expect(Token.verifyTeacherReport(decodeURIComponent(m[1]))).toEqual({ teacherId: T.id, quizId: null });
    expect(mockEvents.find((e) => e.name === 'teacher_report.link_sent').props).toEqual({ userId: T.id, quizId: null, scope: 'all', how: 'text' });
  });

  test('tqh_reports opens the reports list', async () => {
    world({ quizzes: [quiz('qA', 3)] });
    await Home.handleHomeButton('tqh_reports', FROM, T);
    expect(rowsOf()[0].id).toBe('tqr_qA');
  });
});
