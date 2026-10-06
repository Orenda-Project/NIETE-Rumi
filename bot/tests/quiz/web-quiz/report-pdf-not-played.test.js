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
// The document without its <style> (embedded font data is base64 and can hold any byte run).
const body = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '');

test('class known: the children still to play, greyed, name first then the list no.; the PDF carries no report link', async () => {
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

  // NO report token in the PDF (COS ruling 18:09Z): the PDF is forwarded to
  // class groups, and a /r/<token> in it would open every child's name and
  // score to whoever receives the file. It points at /quiz instead.
  expect(hrefs(html)).toEqual([]);
  expect(body(html)).not.toMatch(/\/r\/|\/remind/);
  expect(html).not.toContain(BASE);
  expect(visible).toContain('send /quiz, then tap “My quiz reports”');

  // The live report and the reminder ride the teacher's own caption only.
  const live = (caption().match(new RegExp(`${BASE}/r/[^/\\s]+(?=\\s|$)`)) || [])[0];
  expect(Token.verifyTeacherReport(live.slice(`${BASE}/r/`.length))).toEqual({ teacherId: TEACHER, quizId: QUIZ });
  expect(caption()).toContain(`${live}/remind`);
});

test('the old "not finished" box does not repeat a child the class list already shows', async () => {
  const fake = seed();
  fake.db.quiz_sessions.push({ ...session('s3', 3, 0), status: 'in_progress', completed_at: null });
  await report.generate(SC, { reason: 'scheduled' });
  const html = pdfHtml();
  expect(html).not.toContain('Not finished yet');
  expect((html.match(/Kid3/g) || []).length).toBe(1);
});

test('no class list: no not-played section; the /quiz pointer, never a link', async () => {
  seed({ lists: false });
  await report.generate(SC, { reason: 'scheduled' });
  const html = pdfHtml();
  expect(html).not.toContain('Not played yet');
  expect(body(html)).not.toContain('/r/');
  expect(html).not.toContain(BASE);
  expect(html).toContain('My quiz reports');
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
  expect(html).toContain('میری کوئز رپورٹس');
  expect(html).not.toContain(BASE);
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

describe('the caption: with the class known, ONE class line replaces both counts (M3 173525)', () => {
  // The reminder lives in the caption only: the PDF carries no report link.
  const remindOf = () => (caption().match(new RegExp(`${BASE}/r/[^/\\s]+/remind`)) || [])[0];
  const withHardQuestion = (fake) => {
    fake.db.quiz_questions.push({ id: 'q1', question_text: 'Which part takes in water?', option_a: 'Root', option_b: 'Leaf',
      option_c: 'Stem', option_d: 'Seed', correct_option: 'a' });
    fake.db.quiz_answers.push({ id: 'a1', session_id: 's1', question_id: 'q1', is_correct: true, selected_option: 'a' },
      { id: 'a2', session_id: 's2', question_id: 'q1', is_correct: false, selected_option: 'b' });
  };

  test('class known: "2 of 4 in 3-B played · 2 still to play — tap to remind: <remind link>", no session count', async () => {
    seed();
    await report.generate(SC, { reason: 'scheduled' });
    const cap = caption();
    const remind = remindOf();
    expect(remind.startsWith(`${BASE}/r/`)).toBe(true);
    expect(cap).toContain(`2 of 4 in 3-B played · 2 still to play — tap to remind: ${remind}`);
    expect(cap).not.toMatch(/finished|have not played yet/);
    expect(cap.startsWith('📊 Class results — *Plants*')).toBe(true);
    expect(cap).toMatch(new RegExp(`${BASE}/r/[^/\\s]+(\\s|$)`));   // the live report still rides
  });

  test('the reteach pointer survives, on its own line ahead of the class line (the link ends its line)', async () => {
    withHardQuestion(seed());
    await report.generate(SC, { reason: 'scheduled' });
    const cap = caption();
    expect(cap).toContain('1 question worth reteaching — inside');
    expect(cap.indexOf('worth reteaching')).toBeLessThan(cap.indexOf('in 3-B played'));
    expect(cap).not.toMatch(/\/remind ·/);
  });

  test('an Urdu teacher: the class line in Urdu, numbers and the class name isolated', async () => {
    seed({ teacherLang: 'ur' });
    await report.generate(SC, { reason: 'scheduled' });
    const cap = caption();
    expect(cap).toContain('⁦2⁩');
    expect(cap).toContain('⁦4⁩');
    expect(cap).toContain('⁨3-B⁩');
    expect(cap).toContain('ابھی باقی');
    expect(cap).toContain(remindOf());
    expect(cap).not.toContain('مکمل کیا');
    expect(cap).not.toMatch(/played|finished/);
  });

  test('everyone on the list played: "4 of 4 in 3-B played", no reminder', async () => {
    const fake = seed();
    fake.db.quiz_sessions.push(session('s3', 3, 3), session('s4', 4, 1));
    await report.generate(SC, { reason: 'scheduled' });
    const cap = caption();
    expect(cap).toContain('4 of 4 in 3-B played');
    expect(cap).not.toMatch(/still to play|\/remind|finished/);
  });

  test('no class list: the sessions are all we have — today\'s "2 of 2 finished" + the live link', async () => {
    seed({ lists: false });
    await report.generate(SC, { reason: 'scheduled' });
    const cap = caption();
    expect(cap).toContain('2 of 2 finished');
    expect(cap).not.toMatch(/ in 3-B|still to play/);
    expect(cap).toMatch(new RegExp(`${BASE}/r/[^/\\s]+(\\s|$)`));
  });

  test('teacher not on the list: the caption is exactly today\'s', async () => {
    seed({ gate: null });
    await report.generate(SC, { reason: 'scheduled' });
    expect(caption()).toBe('📊 Class results — *Plants*\n\n2 of 2 finished');
  });
});

test('Urdu: the /quiz in the pointer is an isolated LTR atom (bare, it renders "quiz/")', async () => {
  seed({ language: 'ur' });
  await report.generate(SC, { reason: 'scheduled' });
  expect(body(pdfHtml())).toMatch(/\u2066(<[^>]+>)*\/(<[^>]+>)*quiz(<\/[^>]+>)*\u2069/);
});
