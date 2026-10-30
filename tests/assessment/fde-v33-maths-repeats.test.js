/**
 * bd-5jmnfj.33.4 — repeated products on the v32 Grade 3 Maths paper (REVIEW.md, Should-fix).
 *  G3 Maths Q1 ii (9 x 6) and Q2 iv (6 x 9, 7 x 7, 8 x 6); Q2 ii (6 x 8 against 7 x 7) and Q2 iv;
 *  Q3 iii (305 x 7) and Q5 Task 2 (a) (306 x 7). Stems are the real item text from g3-maths-ch3-exam.json.
 * The flags merge into answerRepeats so the re-ask loop names them.
 */

const { midMathsRepeats: mathsRepeats } = require('../../bot/shared/services/assessment/fde-mid-maths-repeats');
const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');

const item = (slot, question, extra = {}) => ({ slot, question, answer: 'x', ...extra });
const exam = (lists) => ({ unseen: { x: lists } });
const byslot = (flags, slot) => flags.find((f) => f.slot === slot);

const g3 = exam({
  MCQs: [
    item('g3.maths.A.mcq', 'What is 7 x 8?', { options: ['a) 54', 'b) 56'] }),
    item('g3.maths.A.mcq', 'What is 9 x 6?', { options: ['a) 54', 'b) 45'] }),
    item('g3.maths.A.mcq', 'What is 6 x 7?', { options: ['a) 42', 'b) 36'] }),
  ],
  Directed: [
    item('g3.maths.A.directed', 'Compare using <, > or =: 6 x 8 ___ 7 x 7'),
    item('g3.maths.A.directed', 'Arrange in order from smallest to greatest: 6 x 9, 7 x 7, 8 x 6'),
  ],
  Short: [item('g3.maths.B.short', 'Multiply 305 x 7 using the vertical method.')],
  Extended: [
    item('g3.maths.C.extended', 'Task 2: Use the number 306 and the number 7.\n(a) Find 306 x 7 using the vertical method with place value steps.\n(b) Find the product of 6 x 7 and write the number of ones in it.'),
  ],
});

describe('mathsRepeats on the G3 Maths paper', () => {
  const flags = mathsRepeats(g3);

  test('Q2 iv repeats 9 x 6 (Q1 ii) and 7 x 7 / 6 x 8 (Q2 ii): the later slot is flagged with both earlier ones', () => {
    const f = flags.find((x) => x.text.some((t) => t.startsWith('Compare')));
    expect(f).toMatchObject({ slot: 'g3.maths.A.directed', reason: 'giveaway', printed: true });
    expect(f.with).toEqual(['g3.maths.A.mcq', 'g3.maths.A.directed']);
    expect(f.words).toEqual(expect.arrayContaining(['6 x 9', '7 x 7', '8 x 6']));
  });

  test('Q5 Task 2 (a) 306 x 7 is flagged against Q3 iii 305 x 7 (one digit apart, same other factor)', () => {
    const f = byslot(flags, 'g3.maths.C.extended');
    expect(f.with).toContain('g3.maths.B.short');
    expect(f.words).toContain('306 x 7');
  });

  test('Q5 Task 2 (b) 6 x 7 is Q1 iii again and flags the later item', () => {
    expect(byslot(flags, 'g3.maths.C.extended').with).toContain('g3.maths.A.mcq');
    expect(byslot(flags, 'g3.maths.C.extended').words).toContain('6 x 7');
  });

  test('the earlier item is never flagged for a later repeat', () => {
    expect(byslot(flags, 'g3.maths.B.short')).toBeUndefined();
    expect(flags.every((f) => f.slot !== 'g3.maths.A.mcq')).toBe(true);
  });

  test('two table facts one digit apart (7 x 8 and 7 x 9) are different questions', () => {
    expect(mathsRepeats(exam({ M: [item('g3.maths.A.mcq', 'What is 7 x 8?'), item('g3.maths.A.mcq', 'What is 7 x 9?')] }))).toEqual([]);
  });

  test('the same division is a repeat, the operands swapped are not', () => {
    const same = exam({ D: [item('g4.maths.A.directed', 'Divide 5,100 by 14.'), item('g4.maths.B.short', 'Find 5,100 ÷ 14 using long division.')] });
    expect(byslot(mathsRepeats(same), 'g4.maths.B.short').words).toEqual(['5100 ÷ 14']);
    const swapped = exam({ D: [item('g4.maths.A.directed', 'Divide 5,100 by 14.'), item('g4.maths.B.short', 'Find 14 ÷ 5,100.')] });
    expect(mathsRepeats(swapped)).toEqual([]);
  });

  test('a repeat inside one item (Task 3 names 12 x 9 beside 9 x 12) is not flagged', () => {
    const one = exam({ E: [item('g3.maths.C.extended', '(a) Write 12 x 9.\n(c) Which is greater: 12 x 9 or 9 x 12?')] });
    expect(mathsRepeats(one)).toEqual([]);
  });

  test('a paper that is not Grade 3-4 Maths is not checked', () => {
    expect(mathsRepeats(exam({ M: [item('g5.maths.A.mcq', 'What is 9 x 6?'), item('g5.maths.A.mcq', 'What is 6 x 9?')] }))).toEqual([]);
  });
});

describe('merged into answerRepeats', () => {
  test('the 306 x 7 flag reaches the re-ask loop', () => {
    const f = answerRepeats(g3).find((x) => x.slot === 'g3.maths.C.extended');
    expect(f).toBeDefined();
    expect(f.words).toContain('306 x 7');
  });
});
