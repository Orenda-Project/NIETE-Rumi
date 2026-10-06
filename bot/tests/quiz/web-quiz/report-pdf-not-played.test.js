'use strict';
/**
 * The post-completion PDF names who has NOT played yet — greyed first names with
 * list numbers (the child's place on the teacher's list, never called a roll), from the class list — when the quiz's one class is known, and
 * carries two links: "Remind the class" (/r/<token>/remind) and "See the live
 * report" (/r/<token>). The caption gains the live-report line. All of it only
 * for a teacher on app_settings.teacher_report_teachers; absent, the PDF is
 * exactly today's.
 *
 * The roster and the counting come from teacher-report.data.js (run for real
 * here); boundaries faked: Supabase (in-memory, applies filters), WhatsApp, the
 * model SDK (guidance), and the Chromium printer (captures the HTML).
 */
jest.mock('../../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
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

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WhatsAppService = require('../../../shared/services/whatsapp.service');
const { htmlToPdf } = require('../../../shared/utils/html-to-pdf');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const BASE = 'https://portal.example.test';

const session = (id, n, correct) => ({
  id, quiz_id: QUIZ, share_code_id: SC, student_id: kid(n), student_name: `Kid${n} Testwala`, user_id: null,
  student_class: '3', parent_phone: null, status: 'completed', device_ref: `dev-${id}`,
  total_questions_answered: 4, correct_answers: correct, mastery_percentage: correct * 25,
  invited_by_student_id: null, created_at: '2026-10-05T08:00:00Z', completed_at: '2026-10-05T08:05:00Z',
});

function seed({ gate = [TEACHER], lists = true, language = 'en', teacherLang = 'en' } = {}) {
  const fake = makeFake({
    app_settings: gate === null ? [] : [{ key: 'teacher_report_teachers', value: JSON.stringify(gate) }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, teacher_name: 'T',
      topic: 'Plants', language, report_sent_at: null, invited_by_student_id: null, created_at: '2026-10-05T07:00:00Z' }],
    users: [{ id: TEACHER, phone_number: '000', preferred_language: teacherLang, name: 'Teacher Testwala' }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language,
      quiz_source: 'transcript', status: 'sent', list_id: null, created_at: '2026-10-05T07:00:00Z',
      meta: { share_code_id: SC, student_message: `Play: ${BASE}/q/AB12CD` } }],
    student_lists: lists ? [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'B', is_active: true }] : [],
    students: lists ? [1, 2, 3, 4].map((r) => ({ id: kid(r), list_id: LIST, roll_number: r,
      student_name: `Kid${r} Testwala`, student_name_urdu: null, is_active: true })) : [],
    quiz_sessions: [session('s1', 1, 4), session('s2', 2, 2)],
    quiz_questions: [], quiz_answers: [],
  });
  supabase.from.mockImplementation(fake.from);
  supabase.rpc = fake.rpc;
  return fake;
}

const report = require('../../../shared/services/quiz/video-quiz-report.service');
const Token = require('../../../shared/services/quiz/teacher-report-token');
const Gate = require('../../../shared/services/quiz/teacher-report-gate');

beforeEach(() => {
  jest.clearAllMocks();
  Gate._resetCache();
  process.env.VIDEO_REPORT_SEND_CLAIM = 'false';
  process.env.WEB_QUIZ_BASE_URL = BASE;
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
});

const pdfHtml = () => htmlToPdf.mock.calls[0][0];
const caption = () => WhatsAppService.sendDocument.mock.calls[0][3];
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

test('class known: the children still to play, greyed, name first then the list no., and the two links', async () => {
  seed();
  expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
  const html = pdfHtml();
  expect(html).toContain('Not played yet');
  const np = html.slice(html.indexOf('class="np"'));
  expect(np).toMatch(/Kid3[\s\S]*Kid4/);
  expect(np).toMatch(/Kid3<\/span><span class="np-roll">3<\/span>/);   // the name, then its list no.
  expect(np).toContain('list no.');
  const visible = html.replace(/<style[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');
  expect(visible).not.toMatch(/\broll\b/i);   // never called a roll
  expect(np).not.toMatch(/Kid1|Kid2|Testwala/);   // first names only, and only who has not played

  const links = hrefs(html);
  const remind = links.find((h) => h.endsWith('/remind'));
  const live = links.find((h) => /\/r\/[^/]+$/.test(h));
  expect(remind).toBe(`${live}/remind`);
  expect(live.startsWith(`${BASE}/r/`)).toBe(true);
  expect(Token.verifyTeacherReport(live.slice(`${BASE}/r/`.length))).toEqual({ teacherId: TEACHER, quizId: QUIZ });

  expect(caption()).toContain(live);
});

test('the old "not finished" box does not repeat a child the class list already shows', async () => {
  const fake = seed();
  fake.db.quiz_sessions.push({ ...session('s3', 3, 0), status: 'in_progress', completed_at: null });
  await report.generate(SC, { reason: 'scheduled' });
  const html = pdfHtml();
  expect(html).not.toContain('Not finished yet');
  expect((html.match(/Kid3/g) || []).length).toBe(1);
});

test('no class list: no not-played section, the live-report links still ride', async () => {
  seed({ lists: false });
  await report.generate(SC, { reason: 'scheduled' });
  const html = pdfHtml();
  expect(html).not.toContain('Not played yet');
  expect(hrefs(html).some((h) => h.startsWith(`${BASE}/r/`))).toBe(true);
});

test('teacher not on the list (or no setting): the PDF and caption are today\'s', async () => {
  seed({ gate: null });
  await report.generate(SC, { reason: 'scheduled' });
  expect(pdfHtml()).not.toContain('Not played yet');
  expect(pdfHtml()).not.toContain(`${BASE}/r/`);
  expect(caption()).not.toContain(`${BASE}/r/`);

  jest.clearAllMocks();
  Gate._resetCache();
  seed({ gate: ['someone-else'] });
  await report.generate(SC, { reason: 'scheduled' });
  expect(pdfHtml()).not.toContain(`${BASE}/r/`);
});

test('an Urdu quiz: the section in Urdu; the caption line in the teacher\'s own language', async () => {
  seed({ language: 'ur', teacherLang: 'en' });
  await report.generate(SC, { reason: 'scheduled' });
  const html = pdfHtml();
  expect(html).toContain('ابھی نہیں کھیلا');
  expect(html).toContain('کلاس کو یاد دلائیں');
  expect(html).not.toContain('Not played yet');
  expect(caption()).toMatch(/live report/i);
});

test('no portal base URL: no section and no links (a link to nowhere is worse than none)', async () => {
  delete process.env.WEB_QUIZ_BASE_URL;
  delete process.env.PORTAL_URL;
  seed();
  await report.generate(SC, { reason: 'scheduled' });
  expect(pdfHtml()).not.toContain('Not played yet');
  expect(pdfHtml()).not.toMatch(/href="[^"]*\/r\//);
});

describe('the caption carries the count and the reminder (M3 decision 5)', () => {
  const remindOf = (html) => hrefs(html).find((h) => h.endsWith('/remind'));

  test('class known: "2 of 4 have not played yet · tap to remind the class: <remind link>"', async () => {
    seed();
    await report.generate(SC, { reason: 'scheduled' });
    const remind = remindOf(pdfHtml());
    expect(remind.startsWith(`${BASE}/r/`)).toBe(true);
    expect(caption()).toContain(`2 of 4 have not played yet · tap to remind the class: ${remind}`);
  });

  test('an Urdu teacher: the same line in Urdu, the numbers isolated (U+2066…U+2069)', async () => {
    seed({ teacherLang: 'ur' });
    await report.generate(SC, { reason: 'scheduled' });
    const cap = caption();
    expect(cap).toContain('⁦4⁩');
    expect(cap).toContain('⁦2⁩');
    expect(cap).toContain('ابھی نہیں کھیلا');
    expect(cap).toContain(remindOf(pdfHtml()));
    expect(cap).not.toContain('have not played yet');
  });

  test('no class list: no count (it would be a guess) — today\'s caption with the live link', async () => {
    seed({ lists: false });
    await report.generate(SC, { reason: 'scheduled' });
    expect(caption()).not.toMatch(/have not played yet/);
    expect(caption()).toMatch(new RegExp(`${BASE}/r/[^/\\s]+(\\s|$)`));
  });

  test('everyone on the list played: no reminder line', async () => {
    const fake = seed();
    fake.db.quiz_sessions.push(session('s3', 3, 3), session('s4', 4, 1));
    await report.generate(SC, { reason: 'scheduled' });
    expect(caption()).not.toMatch(/have not played yet|\/remind/);
  });
});
