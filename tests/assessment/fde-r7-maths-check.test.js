/**
 * Board-pattern Maths, round 7: an MCQ whose stem asks for a property
 * ("Which number is divisible by 11?") has exactly one option with that property.
 *
 * The equality check (fde-r6-layout A.) compares option values; it cannot see
 * that 4,213 and 5,148 are both divisible by 11. mcqPropertyVerdict tests every
 * option against the property the stem names; an item with 0 or 2+ passing
 * options is not placed and its slot reports short, so the section is re-asked.
 * The red fixtures are the round-2 sandbox papers (maths full_1 xii, full_2 ix,
 * full_3 v), copied verbatim.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { mcqPropertyVerdict } = require('../../bot/shared/services/assessment/maths-check');

const P = Patterns.get('fde_g5_2027').subjects;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };
const mcqsOf = (examJson) => examJson.unseen.objective.MCQs;

// Twenty plain one-key MCQs with item 7 swapped for the one under test.
function mathsWith(item) {
  const list = Array.from({ length: 20 }, (_, i) => (i === 7 ? item : {
    question: `What is ${i + 3} × 4?`,
    options: [`a) ${(i + 3) * 4 + 1}`, `b) ${(i + 3) * 4}`, `c) ${(i + 3) * 4 - 2}`, `d) ${(i + 3) * 4 + 5}`],
    answer: `b) ${(i + 3) * 4}`,
  })).map((q) => ({ slot: 'maths.A.Q1a', marks: 1, ...q }));
  return { unseen: { objective: { MCQs: list } } };
}

// Round-2 sandbox items, verbatim.
const FULL_1_XII = { question: 'Which number is divisible by 11?', options: ['a) 2,314', 'b) 3,527', 'c) 4,213', 'd) 5,148'], answer: 'd) 5,148' };
const FULL_2_IX = { question: 'Which number is divisible by 11?', options: ['a) 2,134', 'b) 3,125', 'c) 4,316', 'd) 5,423'], answer: 'a) 2,134' };
const FULL_3_V = { question: 'Which of these numbers is divisible by 11?', options: ['a) 2,134', 'b) 3,245', 'c) 1,452', 'd) 4,123'], answer: 'c) 1,452' };
const FULL_1_FACTOR = { question: 'Which of these numbers is a factor of 30?', options: ['a) 8', 'b) 9', 'c) 12', 'd) 15'], answer: 'd) 15' };
const FULL_3_PRIME = { question: 'Which number is a prime number?', options: ['a) 51', 'b) 39', 'c) 47', 'd) 57'], answer: 'c) 47' };
const FULL_1_ROUND = { question: 'Round 346,820 to the nearest thousand.', options: ['a) 346,000', 'b) 347,000', 'c) 340,000', 'd) 350,000'], answer: 'b) 347,000' };

function dropped(item) {
  const out = applyLayout(mathsWith(item), P.maths, FDE, { now: NOW });
  return {
    gone: !mcqsOf(out.examJson).some((q) => q.question === item.question),
    short: out.shortfall.find((s) => s.slot === 'maths.A.Q1a'),
    out,
  };
}

describe('A. through the layout: the item is placed only with one right option', () => {
  it('two options divisible by 11 → dropped', () => {
    for (const item of [FULL_1_XII, FULL_2_IX]) {
      const r = dropped(item);
      expect(r.gone).toBe(true);
      expect(r.out.placed).toBe(19);
      expect(r.short).toEqual({ slot: 'maths.A.Q1a', missing: 1 });
    }
  });

  it('three multiples → dropped', () => {
    const r = dropped(FULL_3_V);
    expect(r.gone).toBe(true);
    expect(r.short).toEqual({ slot: 'maths.A.Q1a', missing: 1 });
  });

  it('one key → kept', () => {
    for (const item of [FULL_1_FACTOR, FULL_3_PRIME, FULL_1_ROUND,
      { question: 'Which number is divisible by 11?', options: ['a) 2,314', 'b) 3,527', 'c) 4,215', 'd) 5,148'], answer: 'd) 5,148' }]) {
      const r = dropped(item);
      expect(r.gone).toBe(false);
      expect(r.short).toBeUndefined();
      expect(mcqsOf(r.out.examJson)).toHaveLength(20);
    }
  });

  it('unknown stem → unchecked', () => {
    const item = { question: 'Which shape has four equal sides?', options: ['a) 4', 'b) 8', 'c) 12', 'd) 16'], answer: 'a) 4' };
    expect(mcqPropertyVerdict(item)).toEqual({ ok: null });
    expect(dropped(item).gone).toBe(false);
  });
});

describe('B. mcqPropertyVerdict, property by property', () => {
  const v = (question, options) => mcqPropertyVerdict({ question, options });

  it('divisible by n, factor of n, multiple of n', () => {
    expect(v(FULL_1_XII.question, FULL_1_XII.options)).toEqual({ ok: false, passing: ['c', 'd'] });
    expect(v(FULL_3_V.question, FULL_3_V.options)).toEqual({ ok: false, passing: ['a', 'b', 'c'] });
    expect(v('Which number is divisible by 7?', ['a) 22', 'b) 30', 'c) 41', 'd) 50'])).toEqual({ ok: false, passing: [] });
    expect(v(FULL_1_FACTOR.question, FULL_1_FACTOR.options)).toEqual({ ok: true });
    expect(v('Which is a factor of 36?', ['a) 6', 'b) 9', 'c) 7', 'd) 5'])).toEqual({ ok: false, passing: ['a', 'b'] });
    expect(v('Which number is a multiple of 7?', ['a) 49', 'b) 50', 'c) 51', 'd) 52'])).toEqual({ ok: true });
    expect(v('Which number is a multiple of 6?', ['a) 12', 'b) 18', 'c) 20', 'd) 25'])).toEqual({ ok: false, passing: ['a', 'b'] });
  });

  it('prime, even, odd', () => {
    expect(v(FULL_3_PRIME.question, FULL_3_PRIME.options)).toEqual({ ok: true });
    expect(v('Which number is a prime number?', ['a) 51', 'b) 53', 'c) 47', 'd) 57'])).toEqual({ ok: false, passing: ['b', 'c'] });
    expect(v('Which number is even?', ['a) 13', 'b) 25', 'c) 38', 'd) 41'])).toEqual({ ok: true });
    expect(v('Which of these is an odd number?', ['a) 13', 'b) 26', 'c) 38', 'd) 41'])).toEqual({ ok: false, passing: ['a', 'd'] });
  });

  it('greatest / smallest of the options', () => {
    expect(v('Which number is the largest?', ['a) 5,432,100', 'b) 5,423,100', 'c) 5,342,100', 'd) 5,243,100'])).toEqual({ ok: true });
    expect(v('Which fraction is the greatest?', ['a) 1/2', 'b) 2/5', 'c) 3/4', 'd) 3/5'])).toEqual({ ok: true });
    expect(v('Which decimal is the smallest?', ['a) 4.305', 'b) 4.035', 'c) 4.350', 'd) 4.53'])).toEqual({ ok: true });
    expect(v('Which is the greatest?', ['a) 3/4', 'b) 6/8', 'c) 1/2', 'd) 1/4'])).toEqual({ ok: false, passing: ['a', 'b'] });
  });

  it('rounded to the nearest 10 / 100 / 1000', () => {
    expect(v(FULL_1_ROUND.question, FULL_1_ROUND.options)).toEqual({ ok: true });
    expect(v('What is 457,812 rounded to the nearest thousand?', ['a) 457,000', 'b) 458,000', 'c) 457,800', 'd) 460,000'])).toEqual({ ok: true });
    expect(v('Round 4,350 to the nearest 100.', ['a) 4,300', 'b) 4,400', 'c) 4,000', 'd) 4,350'])).toEqual({ ok: true });
    expect(v('Round 4,350 to the nearest 100.', ['a) 4,300', 'b) 4,200', 'c) 4,000', 'd) 4,350'])).toEqual({ ok: false, passing: [] });
  });

  it('place value of a digit, as a value or as a place name', () => {
    expect(v('What is the value of the digit 4 in 3,142,785?', ['a) 4,000', 'b) 40,000', 'c) 400,000', 'd) 400'])).toEqual({ ok: true });
    expect(v('What is the place value of the digit 9 in 2,907,361?', ['a) Ten thousands', 'b) Millions', 'c) Thousands', 'd) Hundred thousands'])).toEqual({ ok: true });
    expect(v('What is the place value of the digit 9 in 2,907,361?', ['a) Ten thousands', 'b) Millions', 'c) Thousands', 'd) Hundreds'])).toEqual({ ok: false, passing: [] });
  });

  it('commas and Urdu-Indic digits parse', () => {
    expect(v('کون سا عدد 11 سے پورا تقسیم ہوتا ہے؟', ['a) ۲,۳۱۴', 'b) ۳,۵۲۷', 'c) ۴,۲۱۳', 'd) ۵,۱۴۸'])).toEqual({ ok: false, passing: ['c', 'd'] });
    expect(v('Which number is divisible by ۱۱?', ['a) ۲۳۱۴', 'b) ۳۵۲۷', 'c) ۴۲۱۵', 'd) ۵۱۴۸'])).toEqual({ ok: true });
  });

  it('stems that look alike but ask something else stay unchecked', () => {
    for (const [q, options] of [
      ['Which number is the smallest prime number?', ['a) 1', 'b) 2', 'c) 3', 'd) 5']],
      ['What is the smallest 7-digit number?', ['a) 999,999', 'b) 1,000,000', 'c) 1,000,001', 'd) 9,999,999']],
      ['Round each number to the nearest thousand to estimate 198,700 + 301,200. What is the estimate?', ['a) 490,000', 'b) 499,000', 'c) 510,000', 'd) 500,000']],
      ['To round a number to the nearest thousand, which digit do we look at?', ['a) Ones digit', 'b) Tens digit', 'c) Hundreds digit', 'd) Ten thousands digit']],
      ['Which number is NOT divisible by 3?', ['a) 12', 'b) 15', 'c) 16', 'd) 18']],
      ['Which of these is a common factor of 12 and 18?', ['a) 6', 'b) 5', 'c) 4', 'd) 9']],
      ['What is the LCM of 4 and 6?', ['a) 24', 'b) 10', 'c) 2', 'd) 12']],
      ['Which number is divisible by 11?', ['a) 2,314 kg', 'b) 3.5', 'c) 4,213', 'd) 5,148']],
      ['What is the value of the digit 3 in 3,343?', ['a) 3', 'b) 30', 'c) 300', 'd) 3,000']],
    ]) {
      expect(v(q, options)).toEqual({ ok: null });
    }
  });

  it('never throws on a malformed item', () => {
    for (const item of [null, {}, { question: 'Which number is even?' }, { question: 5, options: 'x' }, { question: 'Which number is even?', options: [null, 2] }]) {
      expect(() => mcqPropertyVerdict(item)).not.toThrow();
    }
  });
});
