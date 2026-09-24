'use strict';
/**
 * One attempt per child.
 *
 * A child who re-opens the class link is started again (beginFromCode →
 * startForStudent, nothing blocks it) and the report read EVERY session row
 * for the share code. On production, 6–14 Sep 2026: 1,150 (quiz, child) pairs
 * had more than one completed attempt — 2,035 extra rows in class reports,
 * one child at 40 attempts on one quiz. Retakes are about to become a feature
 * (the child's /quiz), so the report, the class card and the counts must all
 * see one attempt per child: the latest COMPLETED one, else the latest row.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// Force the text fallback so the assertions read the plain summary.
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockRejectedValue(new Error('no renderer in test env')),
}));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const report = require('../../shared/services/quiz/video-quiz-report.service');

function makeListChain(rows) {
  let data = [...(rows || [])];
  const chain = {
    select: () => chain,
    eq: (field, val) => { data = data.filter((r) => r[field] === val); return chain; },
    is: (field, val) => {
      data = data.filter((r) => (val === null ? (r[field] === null || r[field] === undefined) : r[field] === val));
      return chain;
    },
    in: (field, vals) => { data = data.filter((r) => vals.includes(r[field])); return chain; },
    order: () => chain,
    limit: () => chain,
    update: () => chain,
    maybeSingle: async () => ({ data: data[0] || null, error: null }),
    then: (resolve) => resolve({ data, error: null }),
  };
  return chain;
}
function stubSupabase(tables) {
  supabase.from.mockImplementation((table) => makeListChain(tables[table] || []));
}

const SC = 'sc-1';
const shareCode = {
  id: SC, code: 'K7RM2', quiz_id: 'q1', teacher_user_id: 'u1',
  teacher_name: 'Miss Ayesha', topic: 'Proper Fractions', language: 'en', report_sent_at: null,
};
const teacher = { id: 'u1', phone_number: '923001234567', preferred_language: 'en' };
const base = { share_code_id: SC, user_id: null, invited_by_student_id: null, student_class: '4' };

// st-1 took the quiz three times: 3/8, then 6/8, then opened it again and
// abandoned it. st-2 took it once.
const SESSIONS = [
  { ...base, id: 's1', student_id: 'st-1', student_name: 'Ayesha', status: 'completed',
    total_questions_answered: 8, correct_answers: 3, mastery_percentage: 38,
    created_at: '2026-09-14T08:00:00Z', completed_at: '2026-09-14T08:05:00Z' },
  { ...base, id: 's2', student_id: 'st-1', student_name: 'Ayesha', status: 'completed',
    total_questions_answered: 8, correct_answers: 6, mastery_percentage: 75,
    created_at: '2026-09-14T09:00:00Z', completed_at: '2026-09-14T09:05:00Z' },
  { ...base, id: 's3', student_id: 'st-1', student_name: 'Ayesha', status: 'in_progress',
    total_questions_answered: 1, correct_answers: 0, mastery_percentage: 0,
    created_at: '2026-09-14T10:00:00Z', completed_at: null },
  { ...base, id: 's4', student_id: 'st-2', student_name: 'Bilal', status: 'completed',
    total_questions_answered: 8, correct_answers: 8, mastery_percentage: 100,
    created_at: '2026-09-14T08:30:00Z', completed_at: '2026-09-14T08:36:00Z' },
];
// q1 was wrong only in the attempt that no longer counts.
const ANSWERS = [
  { session_id: 's1', question_id: 'q1', is_correct: false, selected_option: 'B' },
  { session_id: 's2', question_id: 'q1', is_correct: true, selected_option: 'A' },
  { session_id: 's4', question_id: 'q1', is_correct: true, selected_option: 'A' },
  { session_id: 's1', question_id: 'q2', is_correct: false, selected_option: 'C' },
  { session_id: 's2', question_id: 'q2', is_correct: false, selected_option: 'C' },
  { session_id: 's4', question_id: 'q2', is_correct: true, selected_option: 'A' },
];
const QUESTIONS = [
  { id: 'q1', external_id: 'tq:q1:S1:1', question_text: 'Which fraction is proper?', option_a: '3/4', option_b: '4/3', option_c: '4/4', correct_option: 'A' },
  { id: 'q2', external_id: 'tq:q1:S2:2', question_text: 'Which is bigger?', option_a: '3/4', option_b: '1/4', option_c: 'equal', correct_option: 'A' },
];

beforeEach(() => jest.clearAllMocks());

describe('bd-2yyry.15 — oneAttemptPerChild()', () => {
  test('keeps the latest COMPLETED attempt per child, dropping older completions and a later abandoned retake', () => {
    const kept = report.oneAttemptPerChild(SESSIONS);
    expect(kept.map((s) => s.id).sort()).toEqual(['s2', 's4']);
  });

  test('a child with no completed attempt keeps their latest row; rows without a student_id pass through', () => {
    const rows = [
      { id: 'a', student_id: 'st-9', status: 'in_progress', created_at: '2026-09-14T08:00:00Z' },
      { id: 'b', student_id: 'st-9', status: 'in_progress', created_at: '2026-09-14T09:00:00Z' },
      { id: 'c', student_id: null, status: 'completed', created_at: '2026-09-14T07:00:00Z' },
    ];
    expect(report.oneAttemptPerChild(rows).map((s) => s.id).sort()).toEqual(['b', 'c']);
  });
});

describe('bd-2yyry.15 — generate() counts children, not session rows', () => {
  test('the scheduled report says 2 of 2 finished with the latest scores, and no question is "missed" only in a dropped attempt', async () => {
    stubSupabase({
      quiz_share_codes: [shareCode], users: [teacher], quiz_sessions: SESSIONS,
      quiz_answers: ANSWERS, quiz_questions: QUESTIONS, quizzes: [{ id: 'q1', meta: {}, quiz_source: 'video', language: 'en' }],
    });
    const sent = await report.generate(SC, { reason: 'scheduled' });
    expect(sent).toBe(true);
    const text = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(text).toContain('2 of 2 students finished.');
    // One class: named once under the title, not after each child.
    expect(text).toContain('Class 4');
    expect(text).toContain('Ayesha — 6/8 (75%)');
    expect(text).not.toContain('3/8');
    expect(text).toContain('Class average: *88%*');
    // q1 was wrong only in the dropped attempt: not worth reteaching.
    expect(text).not.toContain('Which fraction is proper?');
    // q2 was wrong in the kept attempt: 1 of 2 got it wrong.
    expect(text).toContain('Which is bigger?');
    expect(text).toContain('1 of 2 got this wrong');
    expect(logEvent).toHaveBeenCalledWith('video_quiz.retakes_collapsed',
      expect.objectContaining({ shareCodeId: SC, rows: 4, children: 2 }));
  });
});
