'use strict';
/**
 * A counters picture must be able to produce its answer, like a fraction bar.
 *
 * FIGURE_MISMATCH checked fraction_bar (and grid, base_ten) but never
 * count_objects, so counters could sit beside any sum as a "model". In the
 * fractions replays two shipped that way: rows of 2 and 5 counters beside
 * "what is 2 × 5?" (the picture shows 2, 5 and 7, never 10), and rows of 4, 3
 * and 6 beside "what is the LCM of 4, 3 and 6?" (12 is nowhere in it).
 *
 * The answers a counters picture CAN produce: a row's count, the total, the
 * difference between two rows, the number of rows; for a ringed row the number
 * of groups, the size of a group and what is left over; for a laid-out array
 * its rows and columns; and a row's share of the whole as a fraction. A word
 * answer, or a pick of a named row, is not checked.
 *
 * Through the real validator; only the loggers mocked.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const DIGEST = { subject: 'maths', grade_band: '4', slos: [{ id: 'S1', statement: 'multiply and share', taught_level: 'apply' }] };
const ctx = { language: 'en', subject: 'maths', digest: DIGEST, nExpected: 1 };
function q(question, options, figure, over = {}) {
  return {
    slo_id: 'S1', level: 'understand', question, options, correct_index: 0,
    explanation: 'Look at the counters.', selected_because: 'the counters in the lesson',
    distractor_misconceptions: { 1: 'adds instead', 2: 'counts one row' },
    option_feedback: { correct: 'Yes.', wrong: { 1: 'Look again.', 2: 'Count again.' } },
    figure, figure_role: 'model', ...over,
  };
}
const rows = (...counts) => ({ type: 'count_objects', rows: counts.map((count, k) => ({ picto: 'counter', count, label: String(k + 1) })) });
const mismatch = (question) => validate([question], ctx).errors.filter((e) => /^q0: FIGURE_MISMATCH/.test(e));

describe('refused: counters that cannot produce the answer', () => {
  test('rows of 2 and 5 beside "what is 2 × 5?" (10)', () => {
    const e = mismatch(q('To compare the fractions by cross multiplication, what is $2 \\times 5$?', ['10', '7', '3'], rows(2, 5)));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/"10"/);
  });

  test('rows of 4, 3 and 6 beside "what is the LCM of 4, 3 and 6?" (12)', () => {
    expect(mismatch(q('What is the LCM of 4, 3 and 6?', ['12', '24', '18'], rows(4, 3, 6)))).toHaveLength(1);
  });
});

describe('allowed: what a counters picture can show', () => {
  test.each([
    ['a total', 'How many counters are there altogether?', ['7', '6', '8'], rows(3, 4)],
    ['a difference', 'How many more counters are in row 2?', ['2', '8', '5'], rows(3, 5)],
    ['a count', 'How many counters are in the picture?', ['8', '7', '9'], { type: 'count_objects', picto: 'counter', count: 8 }],
    ['the number of groups', '12 counters are put in groups of 4. How many groups are there?', ['3', '4', '12'], { type: 'count_objects', picto: 'counter', count: 12, group: 4 }],
    ['the size of a group', '12 counters are shared into 3 equal groups. How many are in each?', ['4', '3', '12'], { type: 'count_objects', picto: 'counter', count: 12, group: 4 }],
    ['an array product', 'What is $3 \\times 4$?', ['12', '7', '34'], { type: 'count_objects', picto: 'counter', count: 12, perRow: 4 }],
    ['a share of the whole', 'What fraction of the counters are in row 1?', ['$\\frac{3}{7}$', '$\\frac{4}{7}$', '$\\frac{3}{4}$'], rows(3, 4)],
    ['a word answer', 'Which row has more counters?', ['the second row', 'the first row', 'they are equal'], rows(3, 5)],
    ['a named row', 'Which row has more counters?', ['2', '1', 'they are equal'], rows(3, 5)],
  ])('%s', (_what, stem, options, figure) => {
    expect(mismatch(q(stem, options, figure, { figure_role: 'count_compare' }))).toEqual([]);
  });
});
