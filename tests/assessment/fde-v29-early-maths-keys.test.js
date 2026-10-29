/**
 * v28 G1 Maths Q5/Q6 and G2 Maths Q7/Q9/Q11 word problems asked only "Show your working." but the key paid the
 * method mark for "a correct number sentence" (bd-5jmnfj.4.58.4). The method mark now pays any correct working
 * (number sentence, column working, drawing); the answer mark pays the number, the unit word accepted not required.
 * Also: the G1 and G2 Maths prompt rules say so.
 */

const { earlyKeyFixes } = require('../../bot/shared/services/assessment/fde-early-key-fixes');
const g1 = require('../../bot/shared/services/assessment/patterns/early/g1-maths');
const g2 = require('../../bot/shared/services/assessment/patterns/early/g2-maths');

const paper = (type, slot, items) => ({
  unseen: { subjective: { [type]: items } },
  _layout: { sections: [{ id: 'B', slots: [{ slot, type }] }] },
});
const pt = (kind, text) => ({ kind, text, marks: 1 });
const run = (type, slot, item) => earlyKeyFixes(paper(type, slot, [item])).examJson.unseen.subjective[type][0];

describe('G2 Maths word problems: the method mark pays any correct working', () => {
  test('G2 Maths Q7 addition: the number-sentence point becomes any correct way to find 326 + 258', () => {
    const q = run('Addition Word Problem', 'g2.maths.B.Q7', {
      slot: 'g2.maths.B.Q7', answer: '326 + 258 = 584 stickers', marks: 3,
      scheme: { points: [pt('M', 'Writes the correct number sentence 326 + 258'), pt('M', 'A correct method for adding the two numbers with regrouping'), pt('A', 'Correct answer 584')] },
    });
    expect(q.scheme.points[0].text).toBe('Shows a correct way to find 326 + 258 (a number sentence, column working or a drawing)');
    expect(q.scheme.points[0].kind).toBe('M');
    expect(q.scheme.points[1].text).toMatch(/correct method/);
    expect(q.scheme.points[2].text).toBe('Correct answer 584');
    expect(JSON.stringify(q.scheme.points)).not.toMatch(/number sentence 326/);
  });

  test('G2 Maths Q9 subtraction: names the operation, keeps both operands', () => {
    const q = run('Subtraction Word Problem', 'g2.maths.B.Q9', {
      slot: 'g2.maths.B.Q9', answer: '640 - 275 = 365 marbles', marks: 3,
      scheme: { points: [pt('M', 'Writes the correct number sentence 640 - 275'), pt('M', 'A correct method for subtracting with regrouping'), pt('A', 'Correct answer 365')] },
    });
    expect(q.scheme.points[0].text).toBe('Shows a correct way to find 640 - 275 (a number sentence, column working or a drawing)');
  });

  test('G2 Maths Q11 multiplication: "6 x 4 or 4 x 6" becomes one operation, repeated addition allowed', () => {
    const q = run('Multiplication Word Problem', 'g2.maths.B.Q11', {
      slot: 'g2.maths.B.Q11', answer: '6 x 4 = 24 crayons', marks: 3,
      scheme: { points: [pt('M', 'Writes the correct number sentence 6 x 4 or 4 x 6'), pt('M', 'A correct method for finding the product'), pt('A', 'Correct answer 24')] },
    });
    expect(q.scheme.points[0].text).toBe('Shows a correct way to find 6 x 4 (a number sentence, repeated addition or a drawing)');
  });
});

describe('G1 Maths word problems: the answer mark pays the number, any working, unit not required', () => {
  test('G1 Maths Q5 i: "a correct number sentence with the correct sum and unit" pays the sum 9 however it is found', () => {
    const q = run('Addition Word Problems', 'g1.maths.B.Q5', {
      slot: 'g1.maths.B.Q5', answer: '4 + 5 = 9 pencils', marks: 1,
      scheme: { points: [pt('A', 'a correct number sentence with the correct sum and unit')] },
    });
    const t = q.scheme.points[0].text;
    expect(t).toBe('Correct sum 9, however it is worked out (a number sentence, counting or a drawing)');
    expect(t).not.toMatch(/unit|number sentence with/);
    expect(q.scheme.points[0].marks).toBe(1);
  });

  test('G1 Maths Q6 v: "13 - 11 = 2 ducks" pays the difference 2', () => {
    const q = run('Subtraction Word Problems', 'g1.maths.B.Q6', {
      slot: 'g1.maths.B.Q6', answer: '13 - 11 = 2 ducks', marks: 1,
      scheme: { points: [pt('A', 'a correct number sentence with the correct difference and unit')] },
    });
    expect(q.scheme.points[0].text).toBe('Correct difference 2, however it is worked out (a number sentence, counting or a drawing)');
  });

  test('a point that never asked for a number sentence is left as it was', () => {
    const item = { slot: 'g2.maths.B.Q7', answer: '584', marks: 1, scheme: { points: [pt('A', 'Correct answer 584')] } };
    expect(run('Addition Word Problem', 'g2.maths.B.Q7', item)).toEqual(item);
  });
});

describe('prompt rules on those slots', () => {
  const slot = (P, id) => P.sections.flatMap((s) => s.slots).find((s) => s.slot === id);
  test.each([
    [g1, 'g1.maths.B.Q5'], [g1, 'g1.maths.B.Q6'],
    [g2, 'g2.maths.B.Q7'], [g2, 'g2.maths.B.Q9'], [g2, 'g2.maths.B.Q11'],
  ])('%#: the method mark pays any correct working, never "writes the number sentence"', (P, id) => {
    const rule = slot(P, id).prompt_rule;
    expect(rule).toMatch(/any correct working/i);
    expect(rule).toMatch(/never[^.]*number sentence/i);
  });
});
