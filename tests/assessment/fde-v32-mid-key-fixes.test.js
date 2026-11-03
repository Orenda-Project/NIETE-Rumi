/**
 * bd-5jmnfj.33.3 — key fixes a Grade 3-4 paper needs after the v31 review.
 *  G3 GK Q2: five match items each carried the whole five-pair block and the first item's answer
 *  keyed all five pairs, so the printed key read one pair five times.
 *  G3 Maths Q2 iii: "8 x 6 ___ 7 x 7" keyed ">" (48 < 49) and accept listed "<" beside it.
 *  G3 Maths Q5: parts opened "Q5.", "Q6.", "Q7." and the lead read "(Q5, Q6, Q7)".
 *  G4 Maths Q3 i, Q4, Q5 i-ii: A points paid for "a check" the stem never asked for.
 *  G4 Maths Q3 iv, Q5 iii: "using the first three digits" where 63 and 95 are the digits used.
 * Pure data in, data out; exact v31 items as fixtures.
 */

const { midKeyFixes } = require('../../bot/shared/services/assessment/fde-mid-key-fixes');

const exam = (slot, shape, list, subject = 'Maths') => ({
  _layout: { subject, sections: [{ id: 'A', slots: [{ slot, shape }] }] },
  unseen: { objective: { Items: list } },
});
const items = (out) => out.examJson.unseen.objective.Items;

describe('a match block is one pair per item', () => {
  const A = ['غلط فہمی', 'باری', 'بڑے', 'ہاتھ ملانا', 'رویہ'];
  const B = ['صلح', 'کردار', 'وجہ', 'مدد', 'انتظار'];
  const answers = [
    'غلط فہمی: وجہ، باری: انتظار، بڑے: مدد، ہاتھ ملانا: صلح، رویہ: کردار',
    'غلط فہمی: وجہ', 'باری: انتظار', 'بڑے: مدد', 'ہاتھ ملانا: صلح، رویہ: کردار',
  ];
  const list = answers.map((answer) => ({
    slot: 'g3.general_knowledge.A.match', marks: 1, column_a: [...A], column_b: [...B], answer,
    question: 'کالم الف کی چیزوں کو کالم ب کے درست لفظ سے ملائیں',
  }));

  test('G3 GK Q2: item i gets its own column-A word, its matching column-B word and that word as key', () => {
    const out = items(midKeyFixes(exam('g3.general_knowledge.A.match', 'match', list, 'General Knowledge'), { subject: 'general_knowledge' }));
    expect(out.map((q) => q.column_a)).toEqual([['غلط فہمی'], ['باری'], ['بڑے'], ['ہاتھ ملانا'], ['رویہ']]);
    expect(out.map((q) => q.column_b)).toEqual([['وجہ'], ['انتظار'], ['مدد'], ['صلح'], ['کردار']]);
    expect(out.map((q) => q.answer)).toEqual(['وجہ', 'انتظار', 'مدد', 'صلح', 'کردار']);
  });

  test('a one-pair match item is left as it is', () => {
    const one = [{ slot: 'g3.general_knowledge.A.match', column_a: ['باری'], column_b: ['انتظار'], answer: 'انتظار', question: 'ملائیں' }];
    const res = midKeyFixes(exam('g3.general_knowledge.A.match', 'match', one, 'General Knowledge'), { subject: 'general_knowledge' });
    expect(items(res)).toEqual(one);
    expect(res.notes).toEqual([]);
  });
});

describe('a compare item keys the true sign', () => {
  const compare = (answer, accept, common_error) => ({
    slot: 'g3.maths.A.directed', marks: 2, question: 'Compare with <, > or =: 8 x 6 ___ 7 x 7', answer,
    scheme: {
      points: [{ text: 'Correct value of each side (48 and 49)', marks: 1, kind: 'M' }, { text: 'Correct sign', marks: 1, kind: 'A' }],
      accept, common_error, checked: null,
    },
  });

  test('G3 Maths Q2 iii: 48 < 49, so the key is "<", accept drops the bare ">" and the error naming ">" stays', () => {
    const q = compare('>', ['<', '8 x 6 = 48 and 7 x 7 = 49 so 48 < 49'], 'Writing > by thinking the bigger first number gives the bigger product');
    const [out] = items(midKeyFixes(exam('g3.maths.A.directed', 'short', [q]), { subject: 'maths' }));
    expect(out.answer).toBe('<');
    expect(out.scheme.accept).toEqual(['<', '8 x 6 = 48 and 7 x 7 = 49 so 48 < 49']);
    expect(out.scheme.common_error).toBe('Writing > by thinking the bigger first number gives the bigger product');
  });

  test('an error that names the true sign as the slip is turned round', () => {
    const q = compare('>', ['>'], 'Writing < because 8 is smaller than 7 x 7');
    const [out] = items(midKeyFixes(exam('g3.maths.A.directed', 'short', [q]), { subject: 'maths' }));
    expect(out.answer).toBe('<');
    expect(out.scheme.accept).toEqual(['<']);
    expect(out.scheme.common_error).toBe('Writing > because 8 is smaller than 7 x 7');
  });

  test('a right key is untouched', () => {
    const q = { ...compare('<', ['<'], 'Writing >'), question: 'Compare with <, > or =: 6 x 7 ___ 5 x 9' };
    const res = midKeyFixes(exam('g3.maths.A.directed', 'short', [q]), { subject: 'maths' });
    expect(items(res)[0]).toEqual(q);
    expect(res.notes).toEqual([]);
  });
});

describe('an item never carries its own question label', () => {
  test('G3 Maths Q5: "Q5." leaves the part and "(Q5, Q6, Q7)" leaves the lead', () => {
    const q = {
      slot: 'g3.maths.C.extended', marks: 5,
      main_question: 'Answer any 2 of the 3 questions (Q5, Q6, Q7). Each question has parts (a), (b) and (c).',
      question: 'Q5. Use the multiplication 27 x 4.\n(a) Write 27 x 4 as an addition sentence.\n(b) Find the product of 27 x 4.',
      answer: '(a) 27 + 27 + 27 + 27 = 108. (b) 108.', scheme: { points: [], accept: [], common_error: '', checked: null },
    };
    const [out] = items(midKeyFixes(exam('g3.maths.C.extended', 'extended', [q]), { subject: 'maths' }));
    expect(out.question).toBe('Use the multiplication 27 x 4.\n(a) Write 27 x 4 as an addition sentence.\n(b) Find the product of 27 x 4.');
    expect(out.main_question).toBe('Answer any 2 of the 3 questions. Each question has parts (a), (b) and (c).');
  });
});

describe('a check is paid only where the stem asks for one', () => {
  const point = (text) => ({ text, marks: 2, kind: 'A' });
  const q = (question, text) => ({
    slot: 'g4.maths.B.short', marks: 5, question, answer: 'working',
    scheme: { points: [{ text: 'a correct method', marks: 3, kind: 'M' }, point(text)], accept: [], common_error: '', checked: null },
  });
  const textOf = (item) => items(midKeyFixes(exam('g4.maths.B.short', 'short', [item]), { subject: 'maths' }))[0].scheme.points[1];

  test('G4 Maths Q3 i: the bracketed check goes, the marks stay', () => {
    expect(textOf(q('Find the value: 2,318 x 6', 'correct answer 13,908 (a check of the answer, for example by estimation or by division)')))
      .toEqual(point('correct answer 13,908'));
  });
  test('G4 Maths Q5 i and Q4 ii: a check "such as" or "using" a method goes too', () => {
    expect(textOf(q('Multiply 3,476 by 8. Then divide your answer by 4. Write the final result.',
      'correct final result 6,952 (a check of the result, such as 6,952 x 4 = 27,808)')).text).toBe('correct final result 6,952');
    expect(textOf(q('A library has 3,768 books on 12 shelves. How many books are on each shelf?',
      'correct answer 314 books (a check using Quotient x Divisor + Remainder = Dividend)')).text).toBe('correct answer 314 books');
  });
  test('a trailing "with a check" clause goes', () => {
    expect(textOf(q('Find the value: 1,346 x 52', 'correct answer 69,992, with a check')).text).toBe('correct answer 69,992');
  });
  test('G4 Maths Q3 ii asks for the check, so it is kept', () => {
    const text = 'correct answer 672 (a check: 672 x 8 = 5,376)';
    expect(textOf(q('Divide 5,376 by 8 and check your answer.', text)).text).toBe(text);
  });
});

describe('division steps and notes', () => {
  test('G4 Maths Q3 iv: 63 is the first pair of digits 15 goes into, so the point and the error say two', () => {
    const q = {
      slot: 'g4.maths.B.short', marks: 5, question: 'Divide 6,375 by 15 and check your answer.', answer: '63 / 15 = 4, remainder 3 …',
      scheme: {
        points: [{ text: 'a correct method of long division by a 2-digit divisor, using the first three digits to start', marks: 3, kind: 'M' }],
        accept: [], checked: null,
        common_error: 'Trying to divide 15 into 6 and writing a wrong first digit, instead of using the first three digits 637',
      },
    };
    const res = midKeyFixes(exam('g4.maths.B.short', 'short', [q]), { subject: 'maths' });
    const [out] = items(res);
    expect(out.scheme.points[0].text).toBe('a correct method of long division by a 2-digit divisor, using the first two digits to start');
    expect(out.scheme.common_error).toBe('Trying to divide 15 into 6 and writing a wrong first digit, instead of using the first two digits 63');
    expect(res.notes.map((n) => n.reason)).toEqual(['division_steps']);
  });

  test('every change leaves a note naming the slot', () => {
    const q = {
      slot: 'g3.maths.C.extended', marks: 5, main_question: 'Answer any 2 of the 3 questions (Q5, Q6, Q7).',
      question: 'Q5. Use the multiplication 27 x 4.', answer: '108', scheme: { points: [], accept: [], common_error: '', checked: null },
    };
    const res = midKeyFixes(exam('g3.maths.C.extended', 'extended', [q]), { subject: 'maths' });
    expect(res.notes).toEqual([{ slot: 'g3.maths.C.extended', reason: 'label', from: 'Q5. Use the multiplication 27 x 4.', to: 'Use the multiplication 27 x 4.' }]);
  });

  test('an exam without items passes through', () => {
    expect(midKeyFixes({ _layout: { sections: [] }, unseen: {} }, { subject: 'maths' })).toEqual({ examJson: { _layout: { sections: [] }, unseen: {} }, notes: [] });
  });
});
