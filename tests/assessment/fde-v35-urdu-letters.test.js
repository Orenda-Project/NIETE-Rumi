/**
 * v35 G1 Urdu letter items (bd-5jmnfj.4.58): middle-letter MCQ, blank-letter MCQ, Join Letters.
 * Fixtures are the four v34 items plus sound controls.
 */
const L = require('../../bot/shared/services/assessment/fde-early-urdu-letters');

const SLOT = 'g1.urdu.q1';
const P = { sections: [{ slots: [{ slot: SLOT, type: 'MCQs' }] }] };
const mcq = (question, options, answer) => ({ slot: SLOT, question, options, answer, marks: 1 });
const paper = (mcqs, join) => ({ unseen: { objective: { MCQs: mcqs || [] }, subjective: join ? { 'Join Letters': join } : {} } });
const BOOK = 'کتاب میز پر ہے۔ ہاتھی بڑا ہے۔ گڑیا کھیلتی ہے۔';
const lines = (r) => r.flatMap((s) => s.items);

describe('middle-letter MCQ', () => {
  const bad = mcq('لفظ «تتلی» کا درمیانی حرف کون سا ہے؟', ['الف) ی', 'ب) ت', 'ج) ل'], 'ب) ت');
  const ok = mcq('لفظ «قلم» کا درمیانی حرف کون سا ہے؟', ['الف) ق', 'ب) ل', 'ج) م'], 'ب) ل');
  test('v34 تتلی: ل is also a middle letter, two right answers', () => {
    const r = L.letterShortfall(paper([bad]), P, BOOK);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ slot: SLOT, reason: 'answer' });
    expect(lines(r)[0]).toContain('تتلی');
  });
  test('keyed option that is not a middle letter is flagged', () => {
    const q = mcq('لفظ «قلم» کا درمیانی حرف کون سا ہے؟', ['الف) ق', 'ب) ل', 'ج) م'], 'الف) ق');
    expect(L.letterShortfall(paper([q]), P, BOOK)).toHaveLength(1);
  });
  test('sound item قلم is not flagged', () => {
    expect(L.letterShortfall(paper([ok]), P, BOOK)).toEqual([]);
  });
  test('quote style "X" is read too', () => {
    const q = mcq('لفظ "تتلی" کا درمیانی حرف کون سا ہے؟', ['الف) ی', 'ب) ت', 'ج) ل'], 'ب) ت');
    expect(L.letterShortfall(paper([q]), P, BOOK)).toHaveLength(1);
  });
  test('predicate middleLetters drops first and last, strips diacritics', () => {
    expect(L.middleLetters('قَلَم')).toEqual(['ل']);
  });
  test('only urdu slots are checked', () => {
    const q = { ...bad, slot: 'g1.maths.q1' };
    expect(L.letterShortfall(paper([q]), P, BOOK)).toEqual([]);
  });
});

describe('blank-letter MCQ', () => {
  const gur = mcq('گ_ڑیا میں خالی جگہ میں کون سا حرف آئے گا؟', ['الف) ڑ', 'ب) د', 'ج) ر'], 'ب) د');
  const hathi = mcq('ہ_تی میں کون سا حرف لگانے سے لفظ ہاتھی بنے گا؟', ['الف) ا', 'ب) ب', 'ج) ت'], 'الف) ا');
  test('v34 گ_ڑیا keyed د gives گدڑیا, not in the book', () => {
    const r = L.letterShortfall(paper([gur]), P, BOOK);
    expect(r).toHaveLength(1);
    expect(lines(r)[0]).toContain('گدڑیا');
  });
  test('v34 ہ_تی names ہاتھی; key ا gives ہاتی, flagged', () => {
    const r = L.letterShortfall(paper([hathi]), P, BOOK);
    expect(r).toHaveLength(1);
    expect(lines(r)[0]).toContain('ہاتھی');
  });
  test('sound کت_ب key ا with کتاب in the book is not flagged', () => {
    const q = mcq('کت_ب میں کون سا حرف آئے گا؟', ['الف) ا', 'ب) م', 'ج) ز'], 'الف) ا');
    expect(L.letterShortfall(paper([q]), P, BOOK)).toEqual([]);
  });
  test('a distractor that also makes a book word is flagged', () => {
    const q = mcq('کت_ب میں کون سا حرف آئے گا؟', ['الف) ا', 'ب) م', 'ج) ز'], 'الف) ا');
    expect(L.letterShortfall(paper([q]), P, BOOK + ' کتمب')).toHaveLength(1);
  });
  test('fillBlank substitutes the letter', () => {
    expect(L.fillBlank('کت_ب', 'ا')).toBe('کتاب');
  });
});

describe('Join Letters', () => {
  const item = (question, answer, accept) => ({ slot: SLOT, question, answer, ...(accept ? { scheme: { accept } } : {}) });
  test('v34 پ + ن + گ + ھ + ا spells پنگھا, answer پنکھا, flagged', () => {
    const r = L.letterShortfall(paper([], [item('پ + ن + گ + ھ + ا', 'پنکھا')]), P, BOOK);
    expect(r).toHaveLength(1);
    expect(lines(r)[0]).toContain('پنگھا');
  });
  test('ق + ل + م with answer قلم is not flagged', () => {
    expect(L.letterShortfall(paper([], [item('ق + ل + م', 'قلم')]), P, BOOK)).toEqual([]);
  });
  test('a wrong accept entry is flagged', () => {
    expect(L.letterShortfall(paper([], [item('ق + ل + م', 'قلم', ['قلب'])]), P, BOOK)).toHaveLength(1);
  });
  test('joinedLetters drops plus signs and spaces', () => {
    expect(L.joinedLetters('ق + ل + م')).toBe('قلم');
  });
});
