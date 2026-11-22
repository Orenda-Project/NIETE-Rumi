'use strict';
/**
 * bd-5j1zaf — the 12 h WhatsApp report's live-report link says where the open came from: with app_settings
 * quiz_teacher_home_reports on (JSON true only), liveReportExtras gives links.live + "?from=wa"; links.remind never
 * changes. Off, or the switch unreadable, the links are today's.
 *
 * The real report service and data core run (generate → liveReportExtras → the links text sent after the PDF).
 * Faked: Supabase (in-memory, filters applied), WhatsApp, the queue, the model SDK and the Chromium printer.
 * Children are invented "Testwala" fixtures.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png')),
}));
jest.mock('openai', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../shared/services/llm-client', () => ({
  withSpendRecording: () => ({ chat: { completions: { create: () => Promise.reject(new Error('no model in test')) } } }),
}));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const KEY = 'quiz_teacher_home_reports';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const BASE = 'https://portal.example.test';

const session = (id, n, correct) => ({
  id, quiz_id: QUIZ, share_code_id: SC, student_id: kid(n), student_name: `Kid${n} Testwala`, user_id: null,
  student_class: '3', parent_phone: null, status: 'completed', device_ref: `dev-${id}`,
  total_questions_answered: 4, correct_answers: correct, mastery_percentage: correct * 25,
  invited_by_student_id: null, created_at: '2026-11-20T08:00:00Z', completed_at: '2026-11-20T08:05:00Z',
});

function seed({ late = undefined, failRead = false } = {}) {
  const fake = makeFake({
    app_settings: [{ key: 'teacher_report_teachers', value: JSON.stringify([TEACHER]) }, ...(late === undefined ? [] : [{ key: KEY, value: late }])],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, teacher_name: 'T',
      topic: 'Plants', language: 'en', report_sent_at: null, invited_by_student_id: null, created_at: '2026-11-20T07:00:00Z' }],
    users: [{ id: TEACHER, phone_number: '000', preferred_language: 'en', name: 'Teacher Testwala' }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en',
      quiz_source: 'transcript', status: 'sent', list_id: null, created_at: '2026-11-20T07:00:00Z',
      meta: { share_code_id: SC, student_message: `Play: ${BASE}/q/AB12CD` } }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'B', is_active: true }],
    students: [1, 2, 3, 4].map((r) => ({ id: kid(r), list_id: LIST, roll_number: r, student_name: `Kid${r} Testwala`, student_name_urdu: null, is_active: true })),
    quiz_sessions: [session('s1', 1, 4), session('s2', 2, 2)],
    quiz_questions: [], quiz_answers: [],
  });
  supabase.from.mockImplementation((t) => {
    const b = fake.from(t);
    if (!failRead || t !== 'app_settings') return b;
    const { eq } = b;
    b.eq = (c, v) => (c === 'key' && v === KEY ? Promise.resolve({ data: null, error: { message: 'down' } }) : eq(c, v));
    return b;
  });
  supabase.rpc = fake.rpc;
  return fake;
}

const report = require('../../shared/services/quiz/video-quiz-report.service');
const Token = require('../../shared/services/quiz/teacher-report-token');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const Flag = require('../../shared/services/quiz/report-late-flag');

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  Gate._resetCache();
  Flag._resetCache();
  process.env.VIDEO_REPORT_SEND_CLAIM = 'false';
  process.env.WEB_QUIZ_BASE_URL = BASE;
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
});

/** The text after the PDF that carries the report's links: its URLs, in order (remind, then live). */
const linkUrls = () => {
  const msg = WhatsAppService.sendMessage.mock.calls.map((c) => String(c[1])).find((t) => t.includes('/r/'));
  expect(msg).toBeDefined();
  return msg.match(/https:\/\/\S+/g);
};
const tokenOf = (url) => url.slice(`${BASE}/r/`.length).replace(/\/remind$/, '').replace(/\?from=wa$/, '');

test('on: the live link carries ?from=wa; the remind link and the token do not change', async () => {
  seed({ late: true });
  expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
  const [remind, live] = linkUrls();
  expect(live).toMatch(new RegExp(`^${BASE}/r/[A-Za-z0-9._%-]+\\?from=wa$`));
  expect(remind).toMatch(new RegExp(`^${BASE}/r/[A-Za-z0-9._%-]+/remind$`));
  expect(remind).not.toContain('from=');
  expect(tokenOf(live)).toBe(tokenOf(remind));
  expect(Token.verifyTeacherReport(decodeURIComponent(tokenOf(live)))).toEqual({ teacherId: TEACHER, quizId: QUIZ });
});

test.each([
  ['no row', undefined],
  ['the string "true"', 'true'],
  ['false', false],
])('off (%s): the links are today\'s, no from', async (_, late) => {
  seed({ late });
  await report.generate(SC, { reason: 'scheduled' });
  const [remind, live] = linkUrls();
  expect(live).toMatch(new RegExp(`^${BASE}/r/[A-Za-z0-9._%-]+$`));
  expect(remind).toBe(`${live}/remind`);
});

test('the switch unreadable (its read errors): off, links as today', async () => {
  seed({ late: true, failRead: true });
  await report.generate(SC, { reason: 'scheduled' });
  const [remind, live] = linkUrls();
  expect(live).not.toContain('from=');
  expect(remind).toBe(`${live}/remind`);
});

test('the switch read throwing: off, and the report keeps its live section and links', async () => {
  seed({ late: true });
  jest.spyOn(Flag, 'on').mockRejectedValue(new Error('boom'));
  await report.generate(SC, { reason: 'scheduled' });
  const [remind, live] = linkUrls();
  expect(live).not.toContain('from=');
  expect(remind).toBe(`${live}/remind`);
  expect(Flag.on).toHaveBeenCalled();
});
