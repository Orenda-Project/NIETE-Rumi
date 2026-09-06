'use strict';
/**
 * THE NUMBER ON THE CARD IS THE NUMBER IN THE CHROME.
 *
 * The operator's staging screenshot: a chrome bubble reading "Question 7 of 8"
 * sitting directly above a question card whose own header reads
 * "QUESTION 5 OF 8" — and on the next question, "Question 8 of 8" over
 * "QUESTION 6 OF 8". A child cannot tell how far through she is, and a teacher
 * reading over her shoulder cannot match a question to the PDF.
 *
 * The two numbers come from two different places and used to disagree by
 * construction:
 *   - the CARD's number is `i + 1` where `i` is the row's index in the stored
 *     array, i.e. its `sort_order` (transcript-quiz-generate.service renderCards);
 *   - the CHROME's number is `state.index + 1`, the position in the order
 *     `startSession` chose — which was `ORDER BY external_id`, and a transcript
 *     quiz's external_id is `tq:<quizId>:<sloId>:<n>`, so the session walked the
 *     bank in SLO-id string order.
 *
 * This file pins them together for a bank whose SLO order is NOT its position
 * order — the only shape where the bug shows.
 *
 * RUN: node tests/run.js tests/quiz/transcript-quiz-card-number.test.js --forceExit
 */
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Card = require('../../bot/shared/services/quiz/transcript-quiz-card');
const VideoQuiz = require('../../bot/shared/services/quiz/video-quiz.service');
const render = require('../../bot/shared/services/quiz/video-quiz-render.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const QID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * Four authored questions whose SLO ids sort into a DIFFERENT order from their
 * position — S3, S1, S3, S2 against positions 1..4. This is an ordinary lesson:
 * the author walks the SLOs, comes back to one, and the questions are numbered
 * in the order the teacher will read them.
 */
const AUTHORED = [
  { slo_id: 'S3', question: 'Which is a chemical change?', options: ['Ice melting', 'Iron rusting', 'Water boiling'], correct_index: 1 },
  { slo_id: 'S1', question: 'What is matter made of?', options: ['Particles', 'Light', 'Sound'], correct_index: 0 },
  { slo_id: 'S3', question: 'Why is burning paper a chemical change?', options: ['A new substance forms', 'It gets warm', 'It gets smaller'], correct_index: 0 },
  { slo_id: 'S2', question: 'Which state has a fixed shape?', options: ['Solid', 'Liquid', 'Gas'], correct_index: 0 },
].map((q) => ({
  ...q,
  explanation: 'Explained in class.',
  option_feedback: { correct: 'Yes.', wrong: {} },
  level: 'understand',
}));

/** The rows as they are stored: sort_order 0..3, external_id in SLO order. */
const rows = Gen.toRows(QID, AUTHORED, { rng: () => 0 })
  .map((row, i) => ({ ...row, id: `row-${i}` }));

/** The DB hands them back ORDER BY external_id — that is the input startSession sees. */
const asDbReturnsThem = [...rows].sort((a, b) => a.external_id.localeCompare(b.external_id));

describe('the chrome counter and the card counter are the same number', () => {
  test('the fixture is one where SLO order and position order genuinely differ', () => {
    // Otherwise every assertion below would pass on the broken code.
    expect(asDbReturnsThem.map((r) => r.sort_order)).not.toEqual([0, 1, 2, 3]);
  });

  test('a transcript quiz is asked in sort_order, so position k is the row numbered k+1', () => {
    const asked = VideoQuiz.orderForSession(asDbReturnsThem);
    expect(asked.map((r) => r.sort_order)).toEqual([0, 1, 2, 3]);
  });

  test.each([0, 1, 2, 3])('at session position %i the card and the chrome print the same number', (k) => {
    const asked = VideoQuiz.orderForSession(asDbReturnsThem);
    const row = asked[k];

    // The chrome bubble sendNextQuestion sends for this position.
    const chrome = resolveUx('vqQuestionOf', { language: 'en', params: { i: k + 1, n: asked.length } });

    // The card as renderCards drew it: numbered by the row's index in the
    // STORED array, which is its sort_order.
    const storedIndex = rows.findIndex((r) => r.external_id === row.external_id);
    const labels = render.optionLabels(row);
    const html = Card.renderQuestionCardHtml({
      stem: row.question_text, options: labels,
      displayOrder: render.displayOrder(row, labels),
      language: 'en', questionNumber: storedIndex + 1, total: rows.length,
    });

    const printed = /<div class="counter">Question (\d+) of (\d+)<\/div>/.exec(html);
    expect(printed).not.toBeNull();
    expect(chrome).toBe(`*Question ${printed[1]} of ${printed[2]}*`);
  });

  test('the Urdu card counter matches the Urdu chrome too', () => {
    const asked = VideoQuiz.orderForSession(asDbReturnsThem);
    const row = asked[2];
    const storedIndex = rows.findIndex((r) => r.external_id === row.external_id);
    const labels = render.optionLabels(row);
    const html = Card.renderQuestionCardHtml({
      stem: row.question_text, options: labels,
      displayOrder: render.displayOrder(row, labels),
      language: 'ur', questionNumber: storedIndex + 1, total: rows.length,
    });
    const printed = /<div class="counter">([^<]+)<\/div>/.exec(html);
    const chrome = resolveUx('vqQuestionOf', { language: 'ur', params: { i: 3, n: 4 } });
    expect(chrome).toBe(`*${printed[1]}*`);
  });
});
