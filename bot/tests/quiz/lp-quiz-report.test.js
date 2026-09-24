'use strict';
/**
 * R8 lane D task 3.5 — the class report of a quiz born of a LESSON PLAN.
 *
 * Two places in the report asked "is this a transcript quiz?" with a string
 * literal: the digest gate (a non-transcript quiz gets `digest = null`, so the
 * report loses the objectives to reteach and the guidance loses the lesson),
 * and `markReportSent` (only a transcript row flips to `report_sent`, so /quiz
 * would say "sent" forever for an lp_v8 quiz whose report went out). Both now
 * ask `isLessonQuiz`.
 *
 * Driven through the real generate(); the supabase stub APPLIES the filters a
 * query sets, over one fixture quiz row, so a `.eq('quiz_source','transcript')`
 * left on the update really does match nothing.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: {
    completions: {
      create: jest.fn(async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              muddled: 'They carry out of every column once one column carries.',
              board: 'Write 146 + 27 on the board. Ask the class which column reaches ten, and only carry there.',
              check: 'Which column carries in 318 + 45?',
            }),
          },
        }],
      })),
    },
  },
})));

const supabase = require('../../shared/config/supabase');
const { htmlToPdf } = require('../../shared/utils/html-to-pdf');
const report = require('../../shared/services/quiz/video-quiz-report.service');

const SHARE_CODE = {
  id: 'sc-1', code: 'LPQUIZ', quiz_id: 'q1', teacher_user_id: 'u1',
  teacher_name: 'Rifat Noor', topic: 'Adding with carrying', language: 'en', report_sent_at: null,
};
const SESSIONS = [
  { id: 's1', student_name: 'Sana', student_class: '2', status: 'completed', total_questions_answered: 8, correct_answers: 6, mastery_percentage: 75 },
  { id: 's2', student_name: 'Omar', student_class: '2', status: 'completed', total_questions_answered: 8, correct_answers: 4, mastery_percentage: 50 },
];
const ANSWERS = [
  { question_id: 'q-1', selected_option: 'B', is_correct: false },
  { question_id: 'q-1', selected_option: 'B', is_correct: false },
];
const QUESTIONS = [{
  id: 'q-1', external_id: 'tq:q1:S1:1', question_text: 'What is 146 + 27?',
  option_a: '173', option_b: '163', option_c: '1613', correct_option: 'A',
  option_feedback: { wrong: { 1: 'The ones column carried a ten.' } },
}];
const DIGEST = {
  topic_as_taught: 'Adding with carrying',
  slos: [{ id: 'S1', statement: 'Add a 3-digit and a 2-digit number, carrying a ten', statement_en: 'Add a 3-digit and a 2-digit number, carrying a ten', statement_ur: 'دہائی آگے لے جا کر جمع کرنا', taught_level: 'apply' }],
  misconceptions_surfaced: ['Children carry out of every column once they have carried out of one.'],
};

let quizRow;
let quizWrites;
function stub(row) {
  quizRow = row;
  quizWrites = [];
  supabase.from.mockImplementation((table) => {
    const filters = [];
    let patch = null;
    const matches = (r) => filters.every(([op, f, v]) => (op === 'eq' ? r[f] === v : v.includes(r[f])));
    const lists = { quiz_sessions: SESSIONS, quiz_answers: ANSWERS, quiz_questions: QUESTIONS };
    const settle = () => {
      if (table === 'quizzes' && patch) {
        if (matches(quizRow)) { quizWrites.push(patch); Object.assign(quizRow, patch); }
        patch = null;
      }
    };
    const chain = {
      select: () => chain,
      eq: (f, v) => { filters.push(['eq', f, v]); return chain; },
      in: (f, v) => { filters.push(['in', f, v]); return chain; },
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      update: (p) => { patch = p; return chain; },
      maybeSingle: async () => {
        if (table === 'quiz_share_codes') return { data: SHARE_CODE };
        if (table === 'users') return { data: { phone_number: '923001234567', preferred_language: 'en' } };
        if (table === 'quizzes') return { data: matches(quizRow) ? quizRow : null };
        return { data: null };
      },
      then: (resolve) => { settle(); return resolve({ data: lists[table] || [], error: null }); },
    };
    return chain;
  });
}

beforeEach(() => jest.clearAllMocks());

test('an lp_v8 quiz’s report carries the digest-driven objectives, the same as a transcript quiz’s', async () => {
  stub({ id: 'q1', quiz_source: 'lp_v8', language: 'en', subject: 'maths', grade: '2', meta: { digest: DIGEST } });
  await report.generate('sc-1', { reason: 'scheduled' });
  const html = htmlToPdf.mock.calls[0][0];
  expect(html).toContain('Add a 3-digit and a 2-digit number, carrying a ten');
});

test('markReportSent flips an lp_v8 quiz to report_sent, so /quiz stops saying "sent"', async () => {
  stub({ id: 'q1', quiz_source: 'lp_v8', language: 'en', subject: 'maths', grade: '2', meta: { digest: DIGEST } });
  await report.generate('sc-1', { reason: 'scheduled' });
  expect(quizWrites).toContainEqual({ status: 'report_sent' });
});

test('a transcript quiz still flips — and a video quiz still does not', async () => {
  stub({ id: 'q1', quiz_source: 'transcript', language: 'en', subject: 'maths', grade: '2', meta: { digest: DIGEST } });
  await report.generate('sc-1', { reason: 'scheduled' });
  expect(quizWrites).toContainEqual({ status: 'report_sent' });

  htmlToPdf.mockClear();
  stub({ id: 'q1', quiz_source: 'video', language: 'en', subject: 'maths', grade: '2', meta: { digest: DIGEST } });
  await report.generate('sc-1', { reason: 'scheduled' });
  expect(quizWrites).toEqual([]);
  // …and a video quiz never borrows a digest it does not own.
  expect(htmlToPdf.mock.calls[0][0]).not.toContain('Add a 3-digit and a 2-digit number, carrying a ten');
});
