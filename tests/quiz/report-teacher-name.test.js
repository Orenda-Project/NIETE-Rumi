'use strict';
/**
 * The class report is written TO the teacher, so its header never calls them
 * "your teacher".
 *
 * A share code stores `teacher_name` for the CHILDREN: when the teacher has no
 * name on record it stores the children's fallback, "آپ کے استاد" / "Your
 * teacher", which is right in the join greeting a child reads. The report used
 * to print that same field in its header, so a teacher with no stored name read
 * their own report headed "آپ کے استاد · جماعت 4" ("your teacher · Class 4").
 *
 * The report now names the teacher from their own record, and when there is no
 * name it prints the class alone.
 *
 * Driven through the real generate() and the real template; supabase, WhatsApp,
 * the queue and the PDF engine are the only things replaced, and the HTML the
 * PDF engine was handed is what is read.
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

const supabase = require('../../bot/shared/config/supabase');
const { htmlToPdf } = require('../../bot/shared/utils/html-to-pdf');
const report = require('../../bot/shared/services/quiz/video-quiz-report.service');

const SESSIONS = [
  { id: 's1', student_id: 'k1', student_name: 'Hamza', student_class: '4', status: 'completed',
    total_questions_answered: 4, correct_answers: 4, mastery_percentage: 100, completed_at: '2026-09-20T08:00:00Z' },
  { id: 's2', student_id: 'k2', student_name: 'Ayesha', student_class: 'Class 4', status: 'completed',
    total_questions_answered: 4, correct_answers: 3, mastery_percentage: 75, completed_at: '2026-09-20T08:05:00Z' },
];

function stub({ language, storedName, shareCodeName }) {
  supabase.from.mockImplementation((table) => {
    const single = {
      quiz_share_codes: {
        id: 'sc-1', code: 'K7RM2', quiz_id: 'q1', teacher_user_id: 't1', teacher_name: shareCodeName,
        topic: 'Fractions', language, report_sent_at: null,
      },
      users: { phone_number: '920000000000', preferred_language: language, name: storedName },
      quizzes: { quiz_source: 'video', meta: {}, language, subject: 'maths', grade: '4' },
    }[table] || null;
    const list = table === 'quiz_sessions' ? SESSIONS : [];
    const chain = {};
    ['select', 'eq', 'in', 'is', 'update', 'order', 'limit'].forEach((m) => { chain[m] = () => chain; });
    chain.maybeSingle = async () => ({ data: single, error: null });
    chain.then = (resolve, reject) => Promise.resolve({ data: list, error: null }).then(resolve, reject);
    return chain;
  });
}

/** The header line under the topic, as the teacher reads it (markup stripped). */
async function whoLine() {
  await report.generate('sc-1', { reason: 'requested', force: true });
  expect(htmlToPdf).toHaveBeenCalledTimes(1);
  const html = htmlToPdf.mock.calls[0][0];
  const m = html.match(/<div class="who">([\s\S]*?)<\/div>\s*<div class="statrow">/);
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/&middot;/g, '·').replace(/\s+/g, ' ').trim() : null;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('the teacher report names the teacher only from the teacher\'s own record', () => {
  test('Urdu, no stored name: the header is the class alone, never "آپ کے استاد"', async () => {
    stub({ language: 'ur', storedName: null, shareCodeName: 'آپ کے استاد' });
    expect(await whoLine()).toBe('جماعت 4');
  });

  test('English, no stored name: the header is the class alone, never "Your teacher"', async () => {
    stub({ language: 'en', storedName: null, shareCodeName: 'Your teacher' });
    expect(await whoLine()).toBe('Class 4');
  });

  test('a teacher with a name on record reads their name and the class', async () => {
    stub({ language: 'en', storedName: 'Sadia Noor', shareCodeName: 'Sadia Noor' });
    expect(await whoLine()).toBe('Sadia Noor · Class 4');
  });

  test('the name on record wins over the one the share code kept', async () => {
    stub({ language: 'ur', storedName: 'ثنا', shareCodeName: 'آپ کے استاد' });
    expect(await whoLine()).toBe('ثنا · جماعت 4');
  });
});
