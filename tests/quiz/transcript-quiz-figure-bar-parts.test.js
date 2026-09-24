'use strict';
/**
 * A fraction bar of more than 24 parts is drawn as 24.
 *
 * The engine clamps `parts` to 24 (vendor fraction_bar.js). Live (grade 5
 * Urdu, adding unlike fractions): the picture repair drew bars of 24, 48 and
 * 14 parts and asked which one shows the common denominator 24 — the 48-part
 * bar came out as 24 parts, so two bars showed 24 and the question had two
 * right answers. A bar the engine cannot draw as specified is refused before
 * it ships, like any other figure fault, so the repair reverts it.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const DIGEST = { subject: 'maths', grade_band: '5', slos: [{ id: 'S1', statement: 'common denominators', taught_level: 'understand' }] };
const ctx = { language: 'en', subject: 'maths', digest: DIGEST, nExpected: 1 };
const q = (bars) => ({
  slo_id: 'S1', level: 'understand', question: 'Which bar is cut into the most parts?',
  options: ['A', 'B', 'C'], correct_index: 1,
  explanation: 'Count the parts.', selected_because: 'the bars in the lesson',
  distractor_misconceptions: { 0: 'counts shaded parts', 2: 'guesses' },
  option_feedback: { correct: 'Yes.', wrong: { 0: 'Count again.', 2: 'Look again.' } },
  figure: { type: 'fraction_bar', bars }, figure_role: 'read_off',
});
const fine = (v) => v.errors.filter((e) => /^q0: FIGURE_TOO_FINE/.test(e));

test('a bar of 48 parts is refused: it would be drawn as 24', () => {
  const e = fine(validate([q([{ parts: 24, shaded: 4, label: 'A' }, { parts: 48, shaded: 8, label: 'B' }, { parts: 14, shaded: 2, label: 'C' }])], ctx));
  expect(e).toHaveLength(1);
  expect(e[0]).toMatch(/48/);
});

test('24 parts is the most, and passes', () => {
  expect(fine(validate([q([{ parts: 12, shaded: 4, label: 'A' }, { parts: 24, shaded: 8, label: 'B' }, { parts: 6, shaded: 2, label: 'C' }])], ctx))).toEqual([]);
});
