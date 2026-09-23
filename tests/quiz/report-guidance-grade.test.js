'use strict';
/**
 * The "For tomorrow" box is written for a teacher of a particular grade, and the
 * prompt says which: "You are helping a Grade <n> teacher…". generate() used to
 * pass the SHARE CODE's grade — a column the share-code select never reads and
 * the table never had — so every prompt said "Grade primary" (Urdu
 * "گریڈ ابتدائی"), whatever the class. The quiz row does carry the grade and
 * generate() already reads it.
 *
 * Driven through the real generate(): supabase, WhatsApp, the queue and the PDF
 * engine are the only things replaced, and the model is replaced at its network
 * boundary (the `openai` client), so what is asserted is the prompt the model
 * would actually have been sent.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
}));

const mockCreate = jest.fn(async () => ({
  choices: [{
    message: {
      content: JSON.stringify({
        muddled: 'They think the open switch still lets the current through.',
        board: 'Draw the torch circuit on the board. Open the switch and trace the gap with the children. Each pair draws one open and one closed circuit.',
        check: 'Why does the bulb go out when the switch is open?',
      }),
    },
  }],
}));
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: (...args) => mockCreate(...args) } },
})));

const supabase = require('../../bot/shared/config/supabase');
const report = require('../../bot/shared/services/quiz/video-quiz-report.service');

const SHARE = {
  id: 'sc-1', code: 'K7RM2', quiz_id: 'q1', teacher_user_id: 't1', teacher_name: 'Teacher',
  topic: 'Electric circuits', language: 'en', report_sent_at: null,
};
const SESSIONS = [
  { id: 's1', student_id: 'k1', student_name: 'Hamza', student_class: '4', status: 'completed',
    total_questions_answered: 2, correct_answers: 0, mastery_percentage: 0, completed_at: '2026-09-20T08:00:00Z' },
  { id: 's2', student_id: 'k2', student_name: 'Ayesha', student_class: 'Class 4', status: 'completed',
    total_questions_answered: 2, correct_answers: 1, mastery_percentage: 50, completed_at: '2026-09-20T08:05:00Z' },
];
const ANSWERS = [
  { question_id: 'qq1', is_correct: false, selected_option: 'A' },
  { question_id: 'qq1', is_correct: false, selected_option: 'A' },
];
const QUESTIONS = [{
  id: 'qq1', external_id: 'tq:q1:S1:1', question_text: 'What stops the bulb from lighting?',
  option_a: 'the battery', option_b: 'an open switch', option_c: 'the wire', option_d: null,
  correct_option: 'B', option_feedback: null, explanation: 'An open switch leaves a gap in the circuit.',
}];

function stub({ quizRow, language = 'en' }) {
  supabase.from.mockImplementation((table) => {
    const single = {
      quiz_share_codes: { ...SHARE, language },
      users: { phone_number: '920000000000', preferred_language: language },
      quizzes: quizRow,
    }[table] || null;
    const list = { quiz_sessions: SESSIONS, quiz_answers: ANSWERS, quiz_questions: QUESTIONS }[table] || [];
    const chain = {};
    ['select', 'eq', 'in', 'is', 'update', 'order', 'limit'].forEach((m) => { chain[m] = () => chain; });
    chain.maybeSingle = async () => ({ data: single, error: null });
    chain.then = (resolve, reject) => Promise.resolve({ data: list, error: null }).then(resolve, reject);
    return chain;
  });
}

function promptSent() {
  expect(mockCreate).toHaveBeenCalled();
  return mockCreate.mock.calls[0][0].messages[0].content;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('the guidance prompt names the class\'s grade, read from the quiz row', () => {
  test('English: a Grade 4 quiz asks for advice for a Grade 4 teacher', async () => {
    stub({ quizRow: { quiz_source: 'transcript', meta: {}, language: 'en', subject: 'science', grade: '4' } });
    await report.generate('sc-1', { reason: 'requested', force: true });
    const prompt = promptSent();
    expect(prompt).toContain('a Grade 4 teacher');
    expect(prompt).not.toContain('Grade primary');
  });

  test('Urdu: the same class reads گریڈ 4, never گریڈ ابتدائی', async () => {
    stub({ quizRow: { quiz_source: 'transcript', meta: {}, language: 'ur', subject: 'science', grade: '4' }, language: 'ur' });
    await report.generate('sc-1', { reason: 'requested', force: true });
    const prompt = promptSent();
    expect(prompt).toContain('گریڈ 4 استاد');
    expect(prompt).not.toContain('گریڈ ابتدائی');
  });

  test('a stored grade that already names its unit is not doubled ("Grade Grade 5")', async () => {
    stub({ quizRow: { quiz_source: 'lp_v8', meta: {}, language: 'en', subject: 'science', grade: 'Grade 5' } });
    await report.generate('sc-1', { reason: 'requested', force: true });
    const prompt = promptSent();
    expect(prompt).toContain('a Grade 5 teacher');
    expect(prompt).not.toMatch(/Grade\s+Grade/);
  });

  test('a quiz row without a grade falls back to the class the children entered', async () => {
    stub({ quizRow: { quiz_source: 'transcript', meta: {}, language: 'en', subject: 'science', grade: null } });
    await report.generate('sc-1', { reason: 'requested', force: true });
    expect(promptSent()).toContain('a Grade 4 teacher');
  });
});
