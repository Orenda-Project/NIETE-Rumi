'use strict';
/**
 * The teacher's class report for a WEB-arm quiz counts each child's FIRST
 * finished attempt (a replay on a sibling's phone is practice). A WhatsApp
 * quiz keeps the latest attempt — video-quiz-report-one-attempt.test.js.
 */
jest.mock('../../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockRejectedValue(new Error('no renderer in test env')),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WhatsAppService = require('../../../shared/services/whatsapp.service');
const report = require('../../../shared/services/quiz/video-quiz-report.service');

const SC = 'sc-1';
const base = { share_code_id: SC, user_id: null, invited_by_student_id: null, student_class: '4' };
const SESSIONS = [
  { ...base, id: 's1', student_id: 'st-1', student_name: 'Ayesha', status: 'completed', device_ref: 'dev-a',
    total_questions_answered: 8, correct_answers: 3, mastery_percentage: 38,
    created_at: '2026-09-14T08:00:00Z', completed_at: '2026-09-14T08:05:00Z' },
  { ...base, id: 's2', student_id: 'st-1', student_name: 'Ayesha', status: 'completed', device_ref: 'dev-b',
    total_questions_answered: 8, correct_answers: 6, mastery_percentage: 75,
    created_at: '2026-09-14T09:00:00Z', completed_at: '2026-09-14T09:05:00Z' },
  { ...base, id: 's4', student_id: 'st-2', student_name: 'Bilal', status: 'completed', device_ref: 'dev-c',
    total_questions_answered: 8, correct_answers: 8, mastery_percentage: 100,
    created_at: '2026-09-14T08:30:00Z', completed_at: '2026-09-14T08:36:00Z' },
];

function seed(meta, sessions = SESSIONS) {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'K7RM2', quiz_id: 'q1', teacher_user_id: 'u1', teacher_name: 'Teacher Example',
      topic: 'Proper Fractions', language: 'en', report_sent_at: null },
    { id: 'sc-2', code: 'K7RM3', quiz_id: 'q1', teacher_user_id: 'u2', teacher_name: 'Other Example',
      topic: 'Proper Fractions', language: 'en', report_sent_at: null }],
    users: [{ id: 'u1', phone_number: '000', preferred_language: 'en' }],
    quiz_sessions: sessions.map((s) => ({ ...s })), quiz_answers: [], quiz_questions: [],
    quizzes: [{ id: 'q1', meta, quiz_source: 'video', language: 'en' }],
  });
  supabase.from.mockImplementation(fake.from);
  supabase.rpc = fake.rpc;
}

beforeEach(() => jest.clearAllMocks());

test('a class code its children played on the web: the report keeps the first finish (3/8), not the replay', async () => {
  seed({});
  expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
  const text = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
  expect(text).toContain('2 of 2 students finished.');
  expect(text).toContain('Ayesha — 3/8 (38%)');
  expect(text).not.toContain('6/8');
});

const whatsapp = () => SESSIONS.map((s) => ({ ...s, device_ref: null, parent_phone: '000' }));

test("WhatsApp children on a quiz row another teacher's web play once marked: still the latest finish (6/8)", async () => {
  seed({ web_arm: 'web' }, whatsapp());
  expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
  const text = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
  expect(text).toContain('Ayesha — 6/8 (75%)');
});

test("the teacher's own web preview does not make a WhatsApp class a web class", async () => {
  seed({}, [...whatsapp(), { ...SESSIONS[0], id: 's-t', student_id: null, user_id: 'u1', student_name: 'Teacher Example', device_ref: 'dev-t' }]);
  expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
  const text = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
  expect(text).toContain('Ayesha — 6/8 (75%)');
});

test('two teachers, one video-bank quiz: the web class keeps first finishes, the WhatsApp class keeps latest', async () => {
  seed({}, [...SESSIONS.map((s) => ({ ...s })), ...whatsapp().map((s) => ({ ...s, id: `w-${s.id}`, share_code_id: 'sc-2' }))]);
  const rows1 = (await report.loadClassRows(SC)).rows;
  const rows2 = (await report.loadClassRows('sc-2')).rows;
  expect(rows1.find((r) => r.name === 'Ayesha').correct).toBe(3);
  expect(rows2.find((r) => r.name === 'Ayesha').correct).toBe(6);
});
