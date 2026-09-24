'use strict';
/**
 * The class report's WhatsApp text fallback (sent when the PDF cannot be
 * rendered) is plain text, so each line's direction is decided on the phone by
 * its first strong character. In an Urdu report that went wrong twice: the
 * title "📊 *quiz کے نتائج — …*" opens on the Latin term "quiz", and a child's
 * line "• Ayesha — 3/4 (75%)" has no Urdu letter at all, so both were laid out
 * left to right inside an Urdu message. In an English report an Urdu name's
 * line turned right to left. Every line now opens with the document language's
 * mark: U+200F in Urdu, U+200E in English.
 *
 * Driven through the real generate(); the PDF engine is made to fail so the
 * text fallback is what the teacher gets.
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
  htmlToPdf: jest.fn().mockRejectedValue(new Error('render failed')),
}));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const report = require('../../bot/shared/services/quiz/video-quiz-report.service');

const RLM = '\u200F';
const LRM = '\u200E';

function stub(language, classes) {
  const names = ['Ayesha', 'نور', 'Bilal', 'زارا'];
  const sessions = classes.map((c, i) => ({
    id: `s${i}`, student_id: `k${i}`, student_name: names[i % names.length], student_class: c, status: 'completed',
    total_questions_answered: 4, correct_answers: 3 - (i % 3), mastery_percentage: 75 - 25 * (i % 3), completed_at: '2026-09-20T08:00:00Z',
  }));
  supabase.from.mockImplementation((table) => {
    const single = {
      quiz_share_codes: { id: 'sc-1', code: 'K7RM2', quiz_id: 'q1', teacher_user_id: 't1', teacher_name: 'x', topic: 'واحد اور جمع', language, report_sent_at: null },
      users: { phone_number: '920000000000', preferred_language: language, name: null },
      quizzes: { quiz_source: 'video', meta: {}, language, subject: 'urdu', grade: null },
    }[table] || null;
    const list = table === 'quiz_sessions' ? sessions : [];
    const chain = {};
    ['select', 'eq', 'in', 'is', 'update', 'order', 'limit'].forEach((m) => { chain[m] = () => chain; });
    chain.maybeSingle = async () => ({ data: single, error: null });
    chain.then = (resolve, reject) => Promise.resolve({ data: list, error: null }).then(resolve, reject);
    return chain;
  });
}

beforeEach(() => { jest.clearAllMocks(); });

describe('the text fallback states each line\'s direction', () => {
  test.each([
    ['ur', 'one class', ['4', 'Class 4', '۴'], RLM],
    ['ur', 'several classes', ['4', 'Grade 5'], RLM],
    ['en', 'one class', ['4', 'Class 4', '۴'], LRM],
    ['en', 'several classes', ['4', 'Grade 5'], LRM],
  ])('%s, %s', async (language, _label, classes, mark) => {
    stub(language, classes);
    await report.generate('sc-1', { reason: 'requested', force: true });
    const summary = WhatsAppService.sendMessage.mock.calls.map((c) => c[1])[0];
    const lines = summary.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.filter((l) => !l.startsWith(mark))).toEqual([]);
    expect(summary).not.toContain(mark === RLM ? LRM : RLM);
  });
});
