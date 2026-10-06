'use strict';
/**
 * The reteach guidance the post-completion PDF prints is stored on the quiz row
 * (quizzes.meta.report_guidance + report_guidance_at), so the teacher's web
 * report shows the SAME advice without a second model call. It rides the one
 * quizzes update the report already makes when it is stamped as sent — no
 * extra round-trip — and a class-card write that follows must not erase it.
 *
 * Boundaries faked: Supabase (in-memory, applies filters), the model SDK and
 * llm-client, WhatsApp, and the Chromium PDF printer (captures the HTML).
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
const mockCreate = jest.fn();
jest.mock('../../../shared/services/llm-client', () => ({
  withSpendRecording: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { htmlToPdf } = require('../../../shared/utils/html-to-pdf');
const report = require('../../../shared/services/quiz/video-quiz-report.service');

const SC = 'sc-g1';
const QUIZ = 'q-g1';
const GUIDANCE = {
  secure: 'The class can name the parts of a plant and say what each part does.',
  stretch: 'Tomorrow, hold up a carrot and ask which part of the plant it is. Then ask why the plant stores food there.',
};

const DIGEST = { topic_as_taught: 'Parts of a plant', slos: [{ id: 'S1', statement: 'Name the parts of a plant', taught_level: 'taught' }] };

const kid = (id, name, pct) => ({
  id, share_code_id: SC, student_id: `st-${id}`, student_name: name, user_id: null, invited_by_student_id: null,
  student_class: '3', status: 'completed', device_ref: `dev-${id}`, parent_phone: null,
  total_questions_answered: 4, correct_answers: pct / 25, mastery_percentage: pct,
  created_at: '2026-10-05T08:00:00Z', completed_at: '2026-10-05T08:05:00Z',
});

function seed({ quizSource = 'transcript', meta = { share_code_id: SC, digest: DIGEST, keep_me: 1 } } = {}) {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'GG11HH', quiz_id: QUIZ, teacher_user_id: 'u1', teacher_name: 'T',
      topic: 'Plants', language: 'en', report_sent_at: null, created_at: '2026-10-05T07:00:00Z' }],
    users: [{ id: 'u1', phone_number: '000', preferred_language: 'en', name: 'Teacher Testwala' }],
    quiz_sessions: [kid('a', 'Ali Testwala', 100), kid('b', 'Sana Testwala', 100)],
    quiz_answers: [], quiz_questions: [],
    quizzes: [{ id: QUIZ, teacher_id: 'u1', meta, quiz_source: quizSource, language: 'en', subject: 'science', grade: '3', status: 'sent' }],
  });
  supabase.from.mockImplementation(fake.from);
  supabase.rpc = fake.rpc;
  return fake;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(GUIDANCE) } }] });
  process.env.VIDEO_REPORT_SEND_CLAIM = 'false';
  delete process.env.CLASS_CARD_ENABLED;
});

test('the guidance the PDF printed is stored on the quiz, in the same update that marks it reported', async () => {
  const fake = seed();
  expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);

  const html = htmlToPdf.mock.calls[0][0];
  expect(html).toContain(GUIDANCE.stretch);

  const row = fake.db.quizzes[0];
  expect(row.meta.report_guidance).toEqual(GUIDANCE);
  expect(Number.isNaN(Date.parse(row.meta.report_guidance_at))).toBe(false);
  expect(row.meta.keep_me).toBe(1);             // a merge, never a replace
  expect(row.status).toBe('report_sent');

  // One quizzes update, carrying both the status and the guidance.
  const quizUpdates = fake.calls.filter((c) => c.table === 'quizzes' && c.op === 'update');
  expect(quizUpdates).toHaveLength(1);
  expect(quizUpdates[0].payload).toMatchObject({ status: 'report_sent', meta: { report_guidance: GUIDANCE } });
});

test('a class-card write after the report keeps the stored guidance', async () => {
  process.env.CLASS_CARD_ENABLED = 'true';
  const fake = seed();
  fake.db.quiz_sessions.forEach((s) => { s.parent_phone = '111'; s.completed_at = new Date().toISOString(); });
  expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
  const row = fake.db.quizzes[0];
  expect(row.meta.class_cards).toBeDefined();
  expect(row.meta.report_guidance).toEqual(GUIDANCE);
});

test('no guidance (the model failed): nothing is stored and an older stored guidance is left alone', async () => {
  mockCreate.mockRejectedValue(new Error('model down'));
  const old = { secure: 'old', stretch: 'old. old.' };
  const fake = seed({ meta: { share_code_id: SC, digest: DIGEST, report_guidance: old, report_guidance_at: '2026-10-01T00:00:00Z' } });
  expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
  expect(fake.db.quizzes[0].meta.report_guidance).toEqual(old);
  expect(fake.db.quizzes[0].meta.report_guidance_at).toBe('2026-10-01T00:00:00Z');
});
