/**
 * v27 key blockers the stem check exists to catch and did not (bd-5jmnfj.4.58.3): G2 English Q1 (b) keyed who
 * helps whom the wrong way round against its own passage; G5 English Q2 ii (d) keyed False where the passage
 * makes the statement True. The prompt gains a fourth rule — an answer that contradicts its own passage or
 * situation — and names the paper's grade instead of always "Grade 5".
 */

const SC = require('../../bot/shared/services/assessment/fde-stem-check');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027').subjects.english;
const paper = () => ({
  unseen: { objective: { MCQs: [{ slot: 'english.A.Q1a', question: 'Choose the antonym of "happy".', options: ['A. sad', 'B. glad', 'C. merry', 'D. gay'], answer: 'A. sad' }] } },
  _layout: {},
});

test('the header names the grade: 5 by default, the one given otherwise', () => {
  expect(SC.buildStemCheckPrompt(paper(), P).prompt).toMatch(/^STEM CHECK: Grade 5 board question paper\./);
  expect(SC.buildStemCheckPrompt(paper(), P, { grade: 2 }).prompt).toMatch(/^STEM CHECK: Grade 2 board question paper\./);
});

test('rule 4: an answer, point or accept line that contradicts its own passage or situation is a flag', () => {
  const { prompt } = SC.buildStemCheckPrompt(paper(), P);
  expect(prompt).toMatch(/\n4\. Its answer, points or accept line contradict its own passage or situation/);
  expect(prompt).toMatch(/True\/False keyed against what the passage says/);
  expect(prompt).toMatch(/who does what reversed/);
});

test('the pins other suites rely on are still there', () => {
  const { prompt } = SC.buildStemCheckPrompt(paper(), P);
  expect(prompt).toMatch(/contradicts itself/);
  expect(prompt).toMatch(/Do NOT flag/);
  expect(prompt).toMatch(/Most papers have no flags\./);
});
