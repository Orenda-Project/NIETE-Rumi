'use strict';
/**
 * TWO OPTIONS OF THE SAME VALUE ARE TWO RIGHT ANSWERS — behind quiz_author_gates_v2.
 *
 * The red team's blind re-score (5 Oct 2026) found "fold a strip into 8, cover
 * 4: what fraction?" offering 4/8 AND 1/2. Over every sandbox question (12,938)
 * the key and a wrong option name the same number 5 times: 2 are this fault
 * (that one, and a circle of 8 parts with 2 coloured offering 1/4 and 2/8), 3 are
 * fair "lowest form" questions where only one of the equal fractions is the
 * answer. The existing check saw this only under a fraction-bar or grid picture.
 *
 * Flag on: named on the question as a duplicate option (the targeted rewrite
 * repairs it with the distinct-options rule), unless the stem asks for the
 * lowest / simplest form. Flag off: nothing changes.
 */
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const GatesV2 = require('../../bot/shared/services/quiz/quiz-author-gates-v2');

afterEach(() => GatesV2.setEnabled(false));
const F = (a, b) => `$\\frac{${a}}{${b}}$`;
const q = (question, options, ci = 0) => ({
  slo_id: 'S1', level: 'understand', question, options, correct_index: ci,
  explanation: 'Count the covered parts out of all the parts.', selected_because: 'equal parts',
  distractor_misconceptions: { 1: 'x', 2: 'y' }, option_feedback: { correct: 'Yes.', wrong: { 1: 'No.', 2: 'No.' } },
});
const dup = (question, options, authorGates, ci = 0) => validate([q(question, options, ci)], { language: 'en', subject: 'maths', authorGates })
  .errors.filter((e) => /duplicate options/.test(e));

test('flag on: 4/8 keyed beside 1/2 is named, as a duplicate option the rewrite knows how to fix', () => {
  const errs = dup('A strip is folded into 8 equal parts and 4 are covered. What fraction is covered?', [F(4, 8), F(1, 2), F(1, 4)], true);
  expect(errs).toEqual([expect.stringMatching(/^q0: duplicate options — .*same amount/)]);
  const t = Rewrite.rewriteTargets(errs, { partial: true });
  expect(t.indices).toEqual([0]);
});

test('flag on: plain fractions and decimals count too (1/4 keyed beside 2/8; 0.5 beside 1/2)', () => {
  expect(dup('A circle has 8 parts and 2 are coloured. Which fraction is coloured?', ['1/4', '2/8', '8/2'], true)).toHaveLength(1);
  expect(dup('Half of the bar is shaded. Which number shows it?', ['0.5', '1/2', '2'], true)).toHaveLength(1);
});

test('flag on: a "lowest form" question is fair — only one of the equal fractions is in lowest form', () => {
  expect(dup('Simplify 8/12 to its lowest form.', ['2/3', '4/6', '2/4'], true)).toEqual([]);
  expect(dup('Change 0.8 to a simplified fraction.', ['4/5', '8/10', '8/100'], true)).toEqual([]);
  expect(dup('What is 18/24 in its simplest form?', ['3/4', '9/12', '9/4'], true)).toEqual([]);
});

test('flag off: today\'s validator says nothing about it', () => {
  expect(dup('A strip is folded into 8 equal parts and 4 are covered. What fraction is covered?', [F(4, 8), F(1, 2), F(1, 4)], false)).toEqual([]);
});
