'use strict';
/**
 * COLUMN SUMS — written the way a textbook prints them.
 *
 * "Column arithmetic … NO picture — write it in the stem with digits" left a
 * grade 3 subtraction as "452 - 137 = ?" in a line of text. The column sum
 * stays out of the figure engine, but it is now ONE typeset expression — a
 * KaTeX array: the numbers right-aligned under each other, the operator in its
 * own column, a rule, an empty answer row — so the question is a card (the
 * Part A path) and KaTeX draws it as the textbook does.
 *
 * This suite (root, KaTeX stubbed) proves the text half: every WhatsApp TEXT
 * path degrades a column sum to one readable line, the validator measures that
 * line, MATH_TEX accepts the form and names the broken one, the contract
 * teaches it, and a model's JSON carries its row breaks intact. The real
 * typesetting is bot/tests/quiz/quiz-column-sum-katex.test.js.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { mathToText, mathForChat, texFaults, LRI, PDI } = require('../../bot/shared/services/quiz/quiz-math');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { questionContract } = require('../../bot/shared/services/quiz/transcript-quiz-contract');
const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { extractJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');

const SUB = '$\\begin{array}{rr} & 452 \\\\ - & 137 \\\\ \\hline & \\end{array}$';
const ADD3 = '$\\begin{array}{rr} & 245 \\\\ & 132 \\\\ + & 21 \\\\ \\hline & \\end{array}$';
const WORKED = '$\\begin{array}{rr} & 452 \\\\ - & 137 \\\\ \\hline & 315 \\end{array}$';

describe('a column sum reaches every WhatsApp text as one readable line', () => {
  test('subtraction: "452 − 137 = ?", nothing of the TeX left', () => {
    expect(mathToText(`Subtract: ${SUB}`)).toBe('Subtract: 452 − 137 = ?');
    expect(mathForChat(`Subtract: ${SUB}`)).toBe('Subtract: 452 − 137 = ?');
  });

  test('three addends, and a worked sum that carries its result', () => {
    expect(mathToText(ADD3)).toBe('245 + 132 + 21 = ?');
    expect(mathToText(WORKED)).toBe('452 − 137 = 315');
  });

  test('inside Urdu the line is ONE left-to-right isolate, so it never reads backwards', () => {
    const out = mathForChat(`تفریق کریں: ${SUB}`);
    expect(out).toBe(`تفریق کریں: ${LRI}452 − 137 = ?${PDI}`);
  });

  test('never a backslash, "array", "hline" or a stray column letter', () => {
    const flat = mathForChat(`Subtract: ${SUB}`);
    expect(flat).not.toMatch(/\\|array|hline|\brr\b/);
  });
});

describe('MATH_TEX accepts the column sum and names the broken one', () => {
  test('the textbook form is not a fault ("array" is an environment, not a word inside the dollars)', () => {
    expect(texFaults(`Subtract: ${SUB}`)).toEqual([]);
    expect(texFaults(ADD3)).toEqual([]);
  });

  test('a column sum whose rows ran together (the JSON lost its \\\\) is a fault that says how to fix it', () => {
    // what a model's single-escaped "\\" becomes once parsed: a control space, not a row break
    const collapsed = '$\\begin{array}{rr} & 452 \\ - & 137 \\ \\hline & \\end{array}$';
    const faults = texFaults(`Subtract: ${collapsed}`);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatch(/row/i);
    expect(faults[0]).toMatch(/\\\\\\\\/); // tells the model to write \\\\ in the JSON
  });
});

describe('the validator reads the line the child reads', () => {
  const DIGEST = { subject: 'maths', grade_band: '3-5', slos: [{ id: 'S1', statement: 'subtract 3-digit numbers', taught_level: 'apply' }] };
  const q = (stem) => ({
    slo_id: 'S1', level: 'apply', question: stem, options: ['315', '325', '589'], correct_index: 0,
    explanation: 'Take 7 from 12, then 3 from 4, then 1 from 4.', distractor_misconceptions: { 1: 'forgets the regrouped ten', 2: 'adds instead' },
    option_feedback: { correct: 'Yes.', wrong: { 1: 'The tens gave one away.', 2: 'This is take away.' } },
  });
  const text = (i) => ({ ...q(`Which is ${i + 10} - ${i}?`), options: ['10', `${i}`, `${i + 20}`] });

  test('a column-sum stem is not a MATH_TEX fault, and is measured as its flat line', () => {
    const v = validate([q(`Subtract: ${SUB}`), ...[1, 2, 3, 4, 5].map(text)], { language: 'en', subject: 'maths', digest: DIGEST, nExpected: 6 });
    expect(v.errors.filter((e) => /^q0:/.test(e))).toEqual([]);
    // the stored question keeps the source for the card to typeset
    expect(v.questions[0].question).toContain('\\begin{array}');
  });
});

describe('the author is taught the form, and column arithmetic is no longer "digits in the stem"', () => {
  test('the shared question contract carries the column-sum rule with its JSON escaping', () => {
    const c = questionContract({ gradeBand: '3-5' });
    expect(c).toMatch(/COLUMN SUM/);
    expect(c).toContain('\\begin{array}{rr}');
    expect(c).toContain('\\\\\\\\');
  });

  test('the picture rules point column arithmetic at the typeset form', () => {
    const p = buildAuthorPrompt({ digest: { subject: 'maths', grade_band: '3-5', slos: [] }, excerpts: '', language: 'en', gradeBand: '3-5' });
    expect(p).not.toMatch(/Column arithmetic, long division, a written sum: NO picture — write it in the stem with digits\./);
    expect(p).toMatch(/column sum[^\n]*COLUMN SUM/i);
  });
});

describe("a model's JSON carries the row breaks", () => {
  test('doubled backslashes survive the TeX repair: two rows, one rule', () => {
    const reply = JSON.stringify({ q: `Subtract: ${SUB}` });
    const parsed = extractJson(reply);
    expect(parsed.q).toBe(`Subtract: ${SUB}`);
    expect((parsed.q.match(/\\\\/g) || []).length).toBe(2);
  });
});
