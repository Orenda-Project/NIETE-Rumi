'use strict';
/**
 * PICTURES IN A GRADE 1-5 MATHS QUIZ — how many, and what a picture may do.
 *
 * Production had 5.5% of maths items carrying a picture (49 of 884). Two rules
 * kept it there: nothing asked for more than one picture, and FIGURE_REDUNDANT
 * rejected any picture whose numbers the stem states — so the pictorial step a
 * young class is taught with (fraction bars beside "which is larger, 2/3 or
 * 3/5?", counters beside "3 + 4") could never be drawn. Decisions:
 *
 *   - a grade 1-5 maths question may carry a figure with figure_role "model":
 *     it MODELS numbers the stem states; FIGURE_REDUNDANT does not apply, the
 *     answer-leak rule still does. Grade 6+ keeps "earn the figure".
 *   - a grade 1-5 maths quiz aims for at least 3 pictures of 8, never more than
 *     half. Too few is a SOFT complaint (FIGURE_FEW), never fatal.
 *
 * Through the real validator and the real density measure — nothing mocked but
 * the loggers.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { validate, figureDensity } = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const DIGEST = (band) => ({
  subject: 'maths', grade_band: band,
  slos: [{ id: 'S1', statement: 'compare two fractions', taught_level: 'understand' }],
});

const FRACTIONS = { type: 'fraction_bar', bars: [{ parts: 3, shaded: 2 }, { parts: 5, shaded: 3 }] };

function compare(over = {}) {
  return {
    slo_id: 'S1', level: 'understand',
    question: 'Which is larger, $\\frac{2}{3}$ or $\\frac{3}{5}$?',
    options: ['$\\frac{2}{3}$', '$\\frac{3}{5}$', 'they are equal'], correct_index: 0,
    explanation: 'Two thirds of a bar covers more than three fifths of the same bar.',
    distractor_misconceptions: { 1: 'thinks a bigger denominator means a bigger fraction', 2: 'compares only the numerators' },
    option_feedback: { correct: 'Yes — the two-thirds bar is longer.', wrong: { 1: 'Fifths are smaller pieces than thirds.', 2: 'Look at how much of each bar is shaded.' } },
    figure: FRACTIONS, figure_role: 'model',
    ...over,
  };
}
function text(i) {
  return {
    slo_id: 'S1', level: 'recall', question: `Which fraction has ${i + 2} as its denominator?`,
    options: [`1/${i + 2}`, `${i + 2}/1`, `${i + 2}/${i + 3}`], correct_index: 0,
    explanation: 'The denominator is the number under the line.',
    distractor_misconceptions: { 1: 'swaps numerator and denominator', 2: 'reads the wrong number' },
    option_feedback: { correct: 'Yes.', wrong: { 1: 'That puts it on top.', 2: 'Look under the line.' } },
  };
}
const quizWith = (first, n = 6) => [first, ...Array.from({ length: n - 1 }, (_, i) => text(i))];
const q0Errors = (v) => v.errors.filter((e) => /^q0:/.test(e));

describe('figure_role "model" — a supporting manipulative in grade 1-5 maths', () => {
  test('models the numbers the stem states, and is NOT rejected as redundant', () => {
    const v = validate(quizWith(compare()), { language: 'en', subject: 'maths', digest: DIGEST('3-5'), nExpected: 6 });
    expect(q0Errors(v)).toEqual([]);
    expect(v.questions[0].figureSvg).toMatch(/^<svg/);
  });

  test('without the role, the same picture is still redundant', () => {
    const v = validate(quizWith(compare({ figure_role: 'read_off' })), { language: 'en', subject: 'maths', digest: DIGEST('3-5'), nExpected: 6 });
    expect(q0Errors(v).some((e) => /FIGURE_REDUNDANT/.test(e))).toBe(true);
  });

  test('grade 6 and above keep "earn the figure": the role changes nothing there', () => {
    const v = validate(quizWith(compare()), { language: 'en', subject: 'maths', digest: DIGEST('6-8'), nExpected: 6 });
    expect(q0Errors(v).some((e) => /FIGURE_REDUNDANT/.test(e))).toBe(true);
  });

  test('outside maths the role is not a licence either', () => {
    const q = compare({ figure: { type: 'grid', rows: 2, cols: 3, shaded: 4 }, question: 'A grid has 2 rows of 3 and 4 are shaded. How many are shaded?', options: ['4', '6', '2'] });
    const v = validate(quizWith(q), { language: 'en', subject: 'science', digest: { ...DIGEST('1-2'), subject: 'science' }, nExpected: 6 });
    expect(q0Errors(v).some((e) => /FIGURE_REDUNDANT/.test(e))).toBe(true);
  });

  test('the answer-leak rule still holds for a model picture', () => {
    const leaky = compare({ figure: { ...FRACTIONS, showLabels: true } });
    const v = validate(quizWith(leaky), { language: 'en', subject: 'maths', digest: DIGEST('3-5'), nExpected: 6 });
    expect(q0Errors(v).some((e) => /FIGURE_LEAK/.test(e))).toBe(true);
  });

  test('the grade band can come from ctx as well as from the digest', () => {
    const v = validate(quizWith(compare()), { language: 'en', subject: 'maths', digest: { ...DIGEST(''), grade_band: undefined }, gradeBand: '4', nExpected: 6 });
    expect(q0Errors(v)).toEqual([]);
  });
});

describe('figureDensity — how many pictures a grade 1-5 maths quiz aims for', () => {
  const eight = (figured) => Array.from({ length: 8 }, (_, i) => (i < figured ? { figure: FRACTIONS } : {}));

  test('one picture in eight is short by two, and says so as FIGURE_FEW', () => {
    const d = figureDensity(eight(1), { subject: 'maths', gradeBand: '1-2' });
    expect(d).toMatchObject({ applies: true, figured: 1, n: 8, target: 3, need: 2 });
    expect(d.complaint).toMatch(/^FIGURE_FEW — 1\/8 questions carry a picture/);
  });

  test('three of eight is enough; the half cap bounds the target on a short quiz', () => {
    expect(figureDensity(eight(3), { subject: 'maths', gradeBand: '3-5' })).toMatchObject({ need: 0, complaint: null });
    const six = Array.from({ length: 6 }, () => ({}));
    expect(figureDensity(six, { subject: 'maths', gradeBand: '1-2' })).toMatchObject({ target: 3, need: 3 });
  });

  test('never asks for more than half', () => {
    const d = figureDensity(eight(4), { subject: 'maths', gradeBand: '1-2' });
    expect(d.need).toBe(0);
  });

  test('applies to grade 1-5 maths only', () => {
    expect(figureDensity(eight(0), { subject: 'science', gradeBand: '1-2' }).applies).toBe(false);
    expect(figureDensity(eight(0), { subject: 'maths', gradeBand: '6-8' }).applies).toBe(false);
    expect(figureDensity(eight(0), { subject: 'Mathematics', gradeBand: 'grade 3' }).applies).toBe(true);
  });
});
