/**
 * bd-5jmnfj.33.2 — a Maths MCQ's key is the arithmetic the stem asks for.
 * v30 G4 Maths Q1 ix: "What is 7,842 divided by 9?" keyed b) 871; 7,842 = 9 × 871 + 3, so no
 * option was right. The check reads the stem, computes exactly, and: keeps a right key; moves
 * the key to the option that is right; or reports the item so the section is asked again, and
 * on the final pass rewrites the keyed option to the computed answer.
 */

const { mcqArithmetic, mcqNote, computeStem } = require('../../bot/shared/services/assessment/fde-mcq-arithmetic');

const mcq = (question, options, answer, n = 0) => ({ slot: 'g4.maths.A.mcq', n, question, options, answer, marks: 1 });
const paper = (items) => ({
  _layout: { subject: 'maths', sections: [{ id: 'A', slots: [{ slot: 'g4.maths.A.mcq', shape: 'mcq' }] }] },
  unseen: { objective: { MCQs: items } },
});
const first = (out) => out.examJson.unseen.objective.MCQs[0];

describe('computeStem reads the stem', () => {
  test.each([
    ['What is 3,245 x 3?', '9735'],
    ['What is 4,852 ÷ 4?', '1213'],
    ['6,000 divided by 30 = ?', '200'],
    ['Find the product of 1,125 and 12.', '13500'],
    ['What is the sum of 4,275 and 8?', '4283'],
    ['What is the difference between 9,000 and 2,596?', '6404'],
    ['Which number multiplied by 6 gives 4,200?', '700'],
    ['What is the remainder when 7,842 is divided by 9?', '3'],
    ['8 × 5 = ___', '40'],
  ])('%s → %s', (stem, want) => {
    expect(computeStem(stem).value).toBe(want);
  });

  test('inexact division without a remainder ask is reported as quotient and remainder', () => {
    expect(computeStem('What is 7,842 divided by 9?')).toEqual({ value: null, quotient: '871', remainder: '3' });
  });

  test('a stem the model does not read returns null: a property, a place value, rounding, three numbers', () => {
    expect(computeStem('The answer of a multiplication is called the')).toBeNull();
    expect(computeStem('What is the place value of 7 in 4,275?')).toBeNull();
    expect(computeStem('Round 4,275 to the nearest hundred.')).toBeNull();
    expect(computeStem('What is 3 x 4 x 5?')).toBeNull();
    expect(computeStem('Estimate 4,852 ÷ 4.')).toBeNull();
  });
});

describe('mcqArithmetic on a paper', () => {
  test('a right key is left alone, no note, no shortfall', () => {
    const out = mcqArithmetic(paper([mcq('What is 3,245 x 3?', ['a) 9,725', 'b) 9,735', 'c) 9,635', 'd) 9,835'], 'b) 9,735')]), { subject: 'maths' });
    expect(first(out).answer).toBe('b) 9,735');
    expect(out.notes).toEqual([]);
    expect(out.shortfall).toEqual([]);
  });

  test('a wrong key moves to the option that is right', () => {
    const out = mcqArithmetic(paper([mcq('What is 4,852 ÷ 4?', ['a) 1,213', 'b) 1,231', 'c) 1,123', 'd) 1,312'], 'b) 1,231')]), { subject: 'maths' });
    expect(first(out).answer).toBe('a) 1,213');
    expect(out.notes).toEqual([{ slot: 'g4.maths.A.mcq', n: 0, kind: 'key_moved', from: 'b) 1,231', to: 'a) 1,213', computed: '1,213' }]);
    expect(out.shortfall).toEqual([]);
  });

  test('v30 Q1 ix: no option is right → a shortfall that names the item, the stem and the real answer', () => {
    const out = mcqArithmetic(paper([mcq('What is 7,842 divided by 9?', ['a) 861', 'b) 871', 'c) 881', 'd) 872'], 'b) 871', 8)]), { subject: 'maths' });
    expect(first(out).answer).toBe('b) 871');
    expect(out.shortfall).toEqual([{ slot: 'g4.maths.A.mcq', reason: 'mcq_no_correct_option', n: 8, stem: 'What is 7,842 divided by 9?', computed: '871 remainder 3' }]);
    // The label comes from the layout (label_en, else the slot's ordinal across the sections).
    expect(mcqNote(out.shortfall, out.examJson._layout)).toBe('Q1 item ix "What is 7,842 divided by 9?" has no correct option (the answer is 871 remainder 3). '
      + 'Replace it with a stem whose answer is exact and make one option that answer.');
    expect(mcqNote(out.shortfall)).toContain('g4.maths.A.mcq item ix');
  });

  test('the final pass rewrites the keyed option to the computed answer, keeping its label and comma style', () => {
    const out = mcqArithmetic(paper([mcq('What is 2,596 x 73?', ['a) 189,408', 'b) 10,364', 'c) 25,960', 'd) 188,508'], 'a) 189,408')]), { subject: 'maths', fix: true });
    expect(first(out).options).toEqual(['a) 189,508', 'b) 10,364', 'c) 25,960', 'd) 188,508']);
    expect(first(out).answer).toBe('a) 189,508');
    expect(out.notes).toEqual([{ slot: 'g4.maths.A.mcq', n: 0, kind: 'option_rewritten', to: 'a) 189,508', computed: '189,508' }]);
    expect(out.shortfall).toEqual([]);
  });

  test('an option "871 remainder 3" matches an inexact division; a remainder ask matches the remainder', () => {
    const a = mcqArithmetic(paper([mcq('What is 7,842 divided by 9?', ['a) 871 remainder 3', 'b) 871', 'c) 872'], 'b) 871')]), { subject: 'maths' });
    expect(first(a).answer).toBe('a) 871 remainder 3');
    const b = mcqArithmetic(paper([mcq('What is the remainder when 7,842 is divided by 9?', ['a) 1', 'b) 2', 'c) 3'], 'c) 3')]), { subject: 'maths' });
    expect(b.notes).toEqual([]);
    expect(b.shortfall).toEqual([]);
  });

  test('a stem the model does not read, a non-maths paper and a non-mcq slot are left as written', () => {
    const prop = mcqArithmetic(paper([mcq('The answer of a multiplication is called the', ['a) sum', 'b) product'], 'a) sum')]), { subject: 'maths' });
    expect(first(prop).answer).toBe('a) sum');
    expect(prop.shortfall).toEqual([]);
    const sci = mcqArithmetic(paper([mcq('What is 7,842 divided by 9?', ['a) 861', 'b) 871'], 'b) 871')]), { subject: 'science' });
    expect(sci.shortfall).toEqual([]);
    const p = paper([{ slot: 'g4.maths.A.directed', question: 'What is 7,842 divided by 9?', answer: '871' }]);
    p._layout.sections[0].slots[0] = { slot: 'g4.maths.A.directed' };
    expect(mcqArithmetic(p, { subject: 'maths' }).shortfall).toEqual([]);
  });

  test('never throws on a broken shape', () => {
    expect(() => mcqArithmetic(null, { subject: 'maths' })).not.toThrow();
    expect(() => mcqArithmetic({ unseen: { objective: { MCQs: [null, 4, { options: 'x' }] } } }, { subject: 'maths' })).not.toThrow();
    expect(mcqNote([])).toBeNull();
  });
});
