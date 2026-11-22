'use strict';
/**
 * quiz_questions.external_id is unique across ALL quizzes (partial unique index idx_quiz_questions_external_id).
 * A class's rounds on two days running recall from overlapping windows (D-3..D-2, then D-2..D-1), so the same
 * original can be the most-missed on both nights: its recall row must not carry the same external_id twice, or the
 * second night's insert fails and the round is never ready. The id keeps the transcript bank's shape: it starts
 * 'tq:' (video-quiz.service orderForSession) and its SLO segment reads 'recall' (web-quiz-items).
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const Recall = require('../../shared/services/quiz/web-quiz-evening-round-recall');

const ORIG = '0a000000-0000-4000-8000-0000000000f1';
const item = { original: { question: { id: ORIG }, missedBy: ['k1'] }, question: 'What is 2 + 2?', options: ['4', '5', '6'], correct: 'A', explanation: null, reading: false };

test('the same original recalled by two rounds gets two different external ids', () => {
  const monday = Recall.recallRows({ quizId: '11111111-0000-4000-8000-000000000001', items: [item], roundKey: 'c|2026-11-23' });
  const tuesday = Recall.recallRows({ quizId: '11111111-0000-4000-8000-000000000002', items: [item], roundKey: 'c|2026-11-24' });
  expect(monday[0].external_id).not.toBe(tuesday[0].external_id);
});

test('the id keeps the bank shape: tq: first, the SLO segment reads recall', () => {
  const [row] = Recall.recallRows({ quizId: '11111111-0000-4000-8000-000000000001', items: [item], roundKey: 'c|2026-11-23' });
  expect(row.external_id.startsWith('tq:')).toBe(true);
  expect((/^tq:[^:]+:([^:]+):/.exec(row.external_id) || [])[1]).toBe('recall');
  const parts = row.external_id.split(':');
  expect(parts[parts.length - 2]).toBe('recall');
});
