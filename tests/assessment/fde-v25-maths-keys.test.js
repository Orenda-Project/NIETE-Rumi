/**
 * bd-5jmnfj.4.55 — v24 G5 Maths keys (TDD red).
 *  1. Q2 ii accept line 3 is a refusal ("not accepted unless") with a wrong figure (541,256 / 541,258).
 *     An accept entry whose 'a op b = c' is wrong is dropped too.
 *  2. Q2 ii common_error "without regrouping, giving 659,358": the column-wise slip gives 658,742.
 *  3. Q2 v common_error "forgets to place the zero ... giving 296,220": 24,685 × 4 = 98,740.
 *  4. Section C Q5/Q6 stems name no unit, yet the key keeps a U mark (marking-scheme.js:259).
 * Rows are the real v24 g5-maths-exam.json shapes. Chain: normaliseScheme → mathsCheck, as the
 * generator runs it. Board-pattern papers only (exam._layout); plain papers must not change.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');

const MATHS = () => Patterns.get('fde_g5_2027').subjects.maths;
const slot = (id) => MATHS().sections.flatMap((s) => s.slots).find((s) => s.slot === id);
const clone = (o) => JSON.parse(JSON.stringify(o));

const Q2_POINTS = [
  { kind: 'M', text: 'Sets out the numbers correctly by place value', marks: 1 },
  { kind: 'M', text: 'A correct method for regrouping across the zeros', marks: 2 },
  { kind: 'A', text: 'Subtracts every column correctly', marks: 1 },
  { kind: 'A', text: 'Final answer 541,258', marks: 1 },
];
const REFUSAL = 'Subtracting 358,743 from 899,999 to get 541,256 and adding 1 to correct it is not accepted unless the final answer is 541,258';
const q2ii = (over = {}) => ({
  slot: 'maths.B.Q2', lines: 0, marks: 5, blooms: 'Understand',
  answer: '900,000 - 358,742 = 541,258',
  question: 'Subtract 358,742 from 900,000.',
  main_question: 'Solve the following. Show all your working.',
  scheme: {
    accept: ['Vertical column subtraction with regrouping', 'Counting up from 358,742 to 900,000', REFUSAL],
    points: clone(Q2_POINTS), checked: null,
    common_error: 'Subtracts the smaller digit from the larger in each column without regrouping, giving 659,358.',
    ...over,
  },
});
const q2v = () => ({
  slot: 'maths.B.Q2', lines: 0, marks: 5, blooms: 'Understand',
  answer: '24,685 x 47 = 987,400 + 172,795 = Rs. 1,160,195.',
  question: 'A shop earns Rs. 24,685 every day. How much money in rupees does the shop earn in 47 days?',
  main_question: 'Solve the following word problem. Show all your working.',
  scheme: {
    accept: ['Long multiplication by 7 and by 40, then adding', 'Long multiplication with partial products in a different order'],
    points: [
      { kind: 'M', text: 'Chooses multiplication as the operation', marks: 1 },
      { kind: 'M', text: 'A correct method for multiplying by the tens digit (placing a zero)', marks: 1 },
      { kind: 'A', text: 'Partial products 172,795 and 987,400', marks: 2 },
      { kind: 'A', text: 'Final answer Rs. 1,160,195', marks: 1 },
    ],
    checked: null,
    common_error: 'Forgets to place the zero when multiplying by 40, giving 296,220 for the second partial product.',
  },
});
const mult = (accept) => ({
  slot: 'maths.B.Q2', lines: 0, marks: 5, blooms: 'Apply',
  answer: '12,408 × 6 = 74,448', question: 'Multiply 12,408 by 6.',
  scheme: { accept, points: clone(Q2_POINTS), checked: null, common_error: 'Forgets to carry, giving a smaller product.' },
});
const decimalDiv = () => ({
  slot: 'maths.B.Q2', lines: 0, marks: 5, blooms: 'Apply',
  answer: '75.6 ÷ 1.8 = 42', question: 'Divide 75.6 by 1.8.',
  scheme: { accept: ['756 ÷ 18 = 42'], points: clone(Q2_POINTS), checked: null, common_error: 'Moves the decimal point in only one number, giving 4.2 or 420.' },
});

const C_POINTS = (unitText) => [
  { kind: 'K', text: 'a correct formula', marks: 1 },
  { kind: 'M', text: 'correct substitution of the given values', marks: 1 },
  { kind: 'A', text: 'correct calculation', marks: 2 },
  { kind: 'U', text: unitText, marks: 1 },
];
const q5 = (question) => ({
  slot: 'maths.C.Q4-8', lines: 0, marks: 5, blooms: 'Apply',
  answer: 'Area = base × height = 12 × 7 = 84 square units (for example 84 cm² if the lengths are in cm).',
  question, main_question: 'Find the area',
  scheme: { accept: ['84 cm²', '84 m²'], points: C_POINTS('a correct square unit written'), checked: null, common_error: 'Adding base and height.' },
});
const q6 = (question) => ({
  slot: 'maths.C.Q4-8', lines: 0, marks: 5, blooms: 'Apply',
  answer: 'Perimeter = 2 × (length + width) = 2 × (15 + 9) = 2 × 24 = 48 units (for example 48 cm).',
  question, main_question: 'Find the perimeter',
  scheme: { accept: ['48 cm', '48 m'], points: C_POINTS('a correct unit of length written'), checked: null, common_error: 'Multiplying length by width.' },
});

const B = 'Word Problems';
const C = 'Graphs & Geometric Problems';
const fdeExam = (type, rows) => ({
  _layout: { v: 2, subject: 'maths', sections: MATHS().sections },
  unseen: { subjective: { [type]: rows } },
});
const plainExam = (type, rows) => ({ unseen: { subjective: { [type]: rows } } });
/** normaliseScheme → mathsCheck, as the generator chains them; returns the rows. */
function chain(exam, type) {
  const norm = normaliseScheme(exam).examJson;
  return mathsCheck(norm, { subject: 'maths' }).examJson.unseen.subjective[type];
}

describe('1. accept lists only full-mark answers (FDE maths)', () => {
  test('Q2 ii: the "not accepted unless" refusal with 541,256/541,258 is dropped, the two methods stay', () => {
    const [row] = chain(fdeExam(B, [q2ii()]), B);
    expect(row.scheme.accept).toEqual(['Vertical column subtraction with regrouping', 'Counting up from 358,742 to 900,000']);
    expect(row.scheme.accept.some((a) => /541,25[68]/.test(a))).toBe(false);
  });

  test('an accept entry stating a wrong product (12,408 × 6 = 74,449) is dropped', () => {
    const [row] = chain(fdeExam(B, [mult(['Repeated addition', '12,408 × 6 = 74,449'])]), B);
    expect(row.scheme.accept).toEqual(['Repeated addition']);
  });

  test('control: an accept entry stating the right product (74,448) is kept', () => {
    const [row] = chain(fdeExam(B, [mult(['Repeated addition', '12,408 × 6 = 74,448'])]), B);
    expect(row.scheme.accept).toEqual(['Repeated addition', '12,408 × 6 = 74,448']);
  });

  test('control: a plain (non-FDE) paper keeps its accept list exactly as written', () => {
    const rows = [q2ii(), mult(['12,408 × 6 = 74,449'])];
    const want = rows.map((r) => clone(r.scheme.accept));
    const out = mathsCheck(plainExam(B, clone(rows)), { subject: 'maths' }).examJson.unseen.subjective[B];
    expect(out.map((r) => r.scheme.accept)).toEqual(want);
  });
});

describe('2. Q2 ii no-regroup slip figure', () => {
  test('common_error figure is recomputed column-wise: 658,742, not 659,358', () => {
    const [row] = chain(fdeExam(B, [q2ii()]), B);
    expect(row.scheme.common_error).toContain('658,742');
    expect(row.scheme.common_error).not.toContain('659,358');
    expect(row.answer).toBe('900,000 - 358,742 = 541,258');
  });

  test('control: a decimal-point slip no model covers (4.2 or 420) is left as written', () => {
    const [row] = chain(fdeExam(B, [decimalDiv()]), B);
    expect(row.scheme.common_error).toBe('Moves the decimal point in only one number, giving 4.2 or 420.');
  });

  test('control: a plain (non-FDE) paper keeps the 659,358 common_error as written', () => {
    const out = mathsCheck(plainExam(B, [q2ii()]), { subject: 'maths' }).examJson.unseen.subjective[B];
    expect(out[0].scheme.common_error).toBe(q2ii().scheme.common_error);
  });
});

describe('3. Q2 v forgot-the-zero slip figure', () => {
  test('common_error figure is 24,685 × 4 = 98,740, not 296,220; the answer is unchanged', () => {
    const [row] = chain(fdeExam(B, [q2v()]), B);
    expect(row.scheme.common_error).toContain('98,740');
    expect(row.scheme.common_error).not.toContain('296,220');
    expect(row.answer).toBe('24,685 x 47 = 987,400 + 172,795 = Rs. 1,160,195.');
  });

  test('control: a plain (non-FDE) paper keeps the 296,220 common_error as written', () => {
    const out = mathsCheck(plainExam(B, [q2v()]), { subject: 'maths' }).examJson.unseen.subjective[B];
    expect(out[0].scheme.common_error).toBe(q2v().scheme.common_error);
  });
});

describe('4. unit mark only when the stem gives a unit (maths.C.Q4-8)', () => {
  const unitless = (rows) => normaliseScheme(fdeExam(C, rows)).examJson.unseen.subjective[C];
  const kinds = (row) => row.scheme.points.map((p) => [p.kind, p.marks]);

  test('Q5: unitless parallelogram stem folds the U mark into A (A 3, no U)', () => {
    const [row] = unitless([q5('Find the area of a parallelogram with a base of 12 and a height of 7. Write the unit with your answer.')]);
    expect(row.scheme.points.some((p) => p.kind === 'U')).toBe(false);
    expect(row.scheme.points.find((p) => p.kind === 'A').marks).toBe(3);
  });

  test('Q6: unitless notice-board perimeter stem folds the U mark into A (A 3, no U)', () => {
    const [row] = unitless([q6('A rectangular notice board is 15 long and 9 wide. Find its perimeter. Write the unit with your answer.')]);
    expect(row.scheme.points.some((p) => p.kind === 'U')).toBe(false);
    expect(row.scheme.points.find((p) => p.kind === 'A').marks).toBe(3);
  });

  test('control: a stem with cm lengths keeps its U point of 1 mark', () => {
    const [a, p] = unitless([
      q5('Find the area of a parallelogram with a base of 12 cm and a height of 7 cm.'),
      q6('A rectangular notice board is 15 m long and 9 m wide. Find its perimeter.'),
    ]);
    expect(kinds(a)).toEqual([['K', 1], ['M', 1], ['A', 2], ['U', 1]]);
    expect(kinds(p)).toEqual([['K', 1], ['M', 1], ['A', 2], ['U', 1]]);
  });

  test('the writer is told to give every length with its unit', () => {
    expect(slot('maths.C.Q4-8').prompt_rule).toMatch(/lengths? with (its|a) unit|\b12 cm\b/i);
  });
});
