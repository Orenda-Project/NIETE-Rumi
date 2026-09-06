'use strict';
/**
 * THE CARD IS WHERE THE COUNTER LIVES.
 *
 * A question card used to arrive under a separate chat bubble reading
 * "Question 5 of 8" while the picture itself carried "QUESTION 5 OF 8" — two
 * copies of one number, and, before lane A, two numbers that disagreed. The
 * bubble is gone: it cost a whole send off the child's 5-minute window
 * (video-quiz-rate-limiter.service.js) and said nothing the picture did not.
 *
 * That removal rests on ONE assumption, and this file is the assumption's
 * guard: every card the generator renders is given its question number and its
 * total, so the number is always on screen. If renderCards ever stopped
 * passing them, a card question would show no counter at all — the failure
 * would be invisible in every unit test that only looks at the send list.
 *
 * RUN: node tests/run.js tests/quiz/transcript-quiz-card-counter-source.test.js --forceExit
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-card', () => {
  const actual = jest.requireActual('../../bot/shared/services/quiz/transcript-quiz-card');
  return {
    ...actual,
    // Always a card, so the assertion covers every row rather than the subset
    // that happens to carry notation.
    needsQuestionCard: jest.fn(() => true),
    renderQuestionCardPng: jest.fn(async () => Buffer.from('png')),
    uploadCard: jest.fn(async ({ index }) => `https://r2/card${index + 1}.png`),
  };
});

const Card = require('../../bot/shared/services/quiz/transcript-quiz-card');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const QID = '33333333-3333-4333-8333-333333333333';
const AUTHORED = ['S1', 'S2', 'S3'].map((slo, i) => ({
  slo_id: slo, level: 'understand',
  question: `Question ${i + 1}?`,
  options: ['One', 'Two', 'Three'], correct_index: 0,
  explanation: 'Explained in class.',
  option_feedback: { correct: 'Yes.', wrong: { 1: 'No.', 2: 'No.' } },
}));

describe('every rendered question card carries its own counter', () => {
  test('renderCards passes questionNumber and total for every row', async () => {
    const rows = Gen.toRows(QID, AUTHORED, { rng: () => 0 });
    await Gen.renderCards({
      rows, questions: AUTHORED, language: 'en', teacherId: 'teacher-1', quizId: QID,
    });

    const calls = Card.renderQuestionCardPng.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(rows.length);
    calls.forEach((arg) => {
      expect(Number.isInteger(arg.questionNumber)).toBe(true);
      expect(arg.questionNumber).toBeGreaterThanOrEqual(1);
      expect(arg.total).toBe(rows.length);
    });
    // The number is the row's position, so it matches the order the session
    // asks them in (a transcript quiz walks sort_order — see
    // transcript-quiz-card-number.test.js).
    expect(calls.map((a) => a.questionNumber)).toEqual(rows.map((r) => r.sort_order + 1));
  });

  test('the html the card renderer produces actually prints that counter', () => {
    const actual = jest.requireActual('../../bot/shared/services/quiz/transcript-quiz-card');
    const html = actual.renderQuestionCardHtml({
      stem: 'Which is a solid?', options: ['Ice', 'Water', 'Steam'],
      displayOrder: [0, 1, 2], language: 'en', questionNumber: 5, total: 8,
    });
    expect(html).toContain('Question 5 of 8');
  });
});
