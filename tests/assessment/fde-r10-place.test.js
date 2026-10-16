/**
 * Board-pattern checks, round 10: the place-value oracle reads the number-first form.
 *
 * FDE's own model paper writes «In the number 4,305,276, what is the place value of
 * the digit 4?», number first. The round-9 oracle read only «… of the digit 4 in N»,
 * so a number-first item with a wrong key printed unchecked. Both forms are read the
 * same way now; «the number» before N is allowed in either.
 *
 * Red fixture: a recorded sandbox paper's Q1(a) i, copied verbatim (fictional text).
 * Chain: applyLayout (as the generator runs it).
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { mcqPropertyVerdict } = require('../../bot/shared/services/assessment/maths-check');

const P = Patterns.get('fde_g5_2027').subjects;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };

// Maths chapters_1 Q1(a) i (round-5 sandbox), verbatim: the 4 in 8,943,210 is in the ten thousands place.
const NUMBER_FIRST = {
  question: 'In the number 8,943,210, what is the place value of the digit 4?',
  options: ['a) Ten Thousands', 'b) Hundred Thousands', 'c) Thousands', 'd) Millions'],
  answer: 'b) Hundred Thousands',
};

function mathsMcqsWith(item) {
  const list = Array.from({ length: 20 }, (_, i) => (i === 0 ? item : {
    question: `What is ${i + 3} × 4?`,
    options: [`a) ${(i + 3) * 4 + 1}`, `b) ${(i + 3) * 4}`, `c) ${(i + 3) * 4 - 2}`, `d) ${(i + 3) * 4 + 5}`],
    answer: `b) ${(i + 3) * 4}`,
  })).map((q) => ({ slot: 'maths.A.Q1a', marks: 1, ...q }));
  return { unseen: { objective: { MCQs: list } } };
}
function laidMaths(item) {
  const out = applyLayout(mathsMcqsWith(item), P.maths, FDE, { now: NOW });
  return { gone: !out.examJson.unseen.objective.MCQs.some((q) => q.question === item.question), short: out.shortfall.find((s) => s.slot === 'maths.A.Q1a') };
}

const NAMES = ['a) Ten thousands', 'b) Hundred thousands', 'c) Thousands', 'd) Millions'];

describe('place-value oracle, number-first form', () => {
  it('chapters_1 Q1(a) i: 4 in 8,943,210 keyed Hundred Thousands → held, slot short', () => {
    expect(mcqPropertyVerdict(NUMBER_FIRST)).toEqual({ ok: false, passing: ['a'] });
    expect(laidMaths(NUMBER_FIRST)).toEqual({ gone: true, short: { slot: 'maths.A.Q1a', missing: 1 } });
  });

  it('the same item keyed Ten Thousands → kept', () => {
    const right = { ...NUMBER_FIRST, answer: 'a) Ten Thousands' };
    expect(mcqPropertyVerdict(right)).toEqual({ ok: true });
    expect(laidMaths(right)).toEqual({ gone: false, short: undefined });
  });

  it.each([
    'In the number 8,943,210, what is the place value of the digit 4?',
    'In 8,943,210, what is the place value of the digit 4?',
    'In the number 8,943,210 what is the place value of 4?',
    'What is the place value of the digit 4 in the number 8,943,210?',
    'What is the place value of 4 in 8,943,210?',
    'In the number 8,943,210, which place is the digit 4 in?',
    'Which place is the digit 4 in the number 8,943,210?',
  ])('every phrasing reads alike: %s', (question) => {
    expect(mcqPropertyVerdict({ question, options: NAMES, answer: 'b) Hundred thousands' })).toEqual({ ok: false, passing: ['a'] });
    expect(mcqPropertyVerdict({ question, options: NAMES, answer: 'a) Ten thousands' })).toEqual({ ok: true });
  });

  it('number-first value form with number options', () => {
    const q = { question: 'In the number 573,018, what is the value of the digit 7?', options: ['a) 7,000', 'b) 70,000', 'c) 700', 'd) 700,000'] };
    expect(mcqPropertyVerdict({ ...q, answer: 'b) 70,000' })).toEqual({ ok: true });
    expect(mcqPropertyVerdict({ ...q, answer: 'a) 7,000' })).toEqual({ ok: false, passing: ['b'] });
  });

  it('a digit twice, or a number that is not whole, stays unchecked (never a replacement)', () => {
    for (const question of [
      'In the number 4,415,230, what is the place value of the digit 4?',
      'In the number 3.5 million, what is the place value of the digit 3?',
      'In 8,943.21, what is the place value of the digit 4?',
      'In the number 4,250 thousand, what is the place value of the digit 4?',
    ]) {
      expect(mcqPropertyVerdict({ question, options: NAMES, answer: 'a) Ten thousands' })).toEqual({ ok: null });
    }
  });

  it('a stem with two numbers before the ask is unchecked', () => {
    expect(mcqPropertyVerdict({ question: 'In the number 8,943,210, what is the place value of the digit 4 in 41,000?', options: NAMES, answer: 'a) Ten thousands' })).toEqual({ ok: null });
  });
});
