/**
 * v37r4 G5 Maths (bd-5jmnfj.4.58.9.1): a term that is the keyed answer of a "name" item must not be printed in another
 * item's stem or options (Q4 iii «Complementary angles» handed Q8 its answer); and the key legend's no-working rule
 * must agree with the per-item no-working line.
 */
const { mathsNameGiveaways } = require('../../bot/shared/services/assessment/fde-maths-name-giveaway');
const { paperGiveaways } = require('../../bot/shared/services/assessment/fde-g5-paper-giveaways');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { mathsMarking } = require('../../bot/shared/services/assessment/fde-maths-marking');

const paper = (list) => ({ unseen: { x: { y: list } }, _layout: { sections: [{ slots: [...new Set(list.map((q) => q.slot))].map((slot) => ({ slot, type: 'y' })) }] } });
const draw = { slot: 'maths.C.Q4-8', question: 'Draw and identify any two of the following angles.', questions: ['Acute angle', 'Reflex angle', 'Complementary angles'], answer: 'Acute angle: draw it. Complementary angles: draw two adjacent angles adding to 90 degrees and name them complementary.' };
const name = { slot: 'maths.C.Q4-8', question: 'Two angles together make a straight line. One of them is 115°. Find the other angle. Then find the angle that must be added to it to make a right angle, and name the pair of those two angles.', answer: 'Other angle = 180 - 115 = 65 degrees. Angle to make a right angle = 90 - 65 = 25 degrees. The 65 degree and 25 degree angles are complementary angles.', scheme: { points: [{ text: 'pair named complementary angles', marks: 1, kind: 'A' }], accept: [] } };

describe('a keyed name printed in another item', () => {
  test('Q4 iii printing "Complementary angles" is flagged when the Q8 key is complementary', () => {
    const out = mathsNameGiveaways(paper([draw, name]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ reason: 'giveaway', printed: true });
    expect(out[0].words).toContain('complementary');
    expect(paperGiveaways(paper([draw, name])).some((f) => f.words && f.words.includes('complementary'))).toBe(true);
  });
  test('an item that only has the name in its own key is not flagged; nor is a paper without the clash', () => {
    const other = { ...draw, questions: ['Acute angle', 'Reflex angle', 'Obtuse angle'], answer: 'Acute angle: draw it.' };
    expect(mathsNameGiveaways(paper([other, name]))).toEqual([]);
    expect(mathsNameGiveaways(paper([name]))).toEqual([]);
  });
  test('an MCQ option that prints the keyed name is flagged; never throws on empty input', () => {
    const mcq = { slot: 'maths.A.Q1a', question: 'Angles that add to 90° are called', options: ['(a) Complementary angles', '(b) Acute'], answer: 'a' };
    expect(mathsNameGiveaways(paper([mcq, name]))).toHaveLength(1);
    expect(mathsNameGiveaways(null)).toEqual([]);
    expect(mathsNameGiveaways({})).toEqual([]);
  });
  test('the item that asks for the name is not flagged for its own stem, and science slots are ignored', () => {
    const self = { ...name, question: `${name.question} Complementary or supplementary?` };
    expect(mathsNameGiveaways(paper([self]))).toEqual([]);
    expect(mathsNameGiveaways(paper([{ ...draw, slot: 'science.C.Q1' }, name]))).toEqual([]);
  });
});

describe('the G5 Maths no-working rule is one rule', () => {
  const legend = Patterns.subjectOf('fde_g5_2027', 'maths').legend.lines_en.find((l) => /no working/i.test(l));
  const perItem = mathsMarking({ slot: 'maths.B.Q1b', question: 'x', answer: '6', scheme: { points: [{ text: 'm', marks: 1, kind: 'M' }, { text: 'a', marks: 1, kind: 'A' }], accept: [] } }, []).scheme.accept.find((l) => /no working/i.test(l));
  test('the legend line promises the answer mark and the per-item line says the same', () => {
    expect(legend).toMatch(/still earns the answer mark\(s\)/);
    expect(legend).toMatch(/working mark is only for steps shown/);
    expect(legend).toBe(perItem);
  });
  test('no "A mark(s) only" restriction and no Q1(b) both-marks carve-out remain', () => {
    expect(legend).not.toMatch(/only \(|A mark\(s\) only|both marks/i);
  });
  test('the G5 Maths Q4-8 rule says exactly which pair a "name the pair" request means', () => {
    const slot = Patterns.subjectOf('fde_g5_2027', 'maths').sections.flatMap((s) => s.slots).find((s) => s.slot === 'maths.C.Q4-8');
    expect(slot.prompt_rule).toMatch(/never "name that pair"/);
    expect(slot.prompt_rule).toMatch(/never printed in another item/i);
  });
});
