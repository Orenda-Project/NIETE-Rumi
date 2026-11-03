/**
 * bd-5jmnfj.4.58.2: v26 G5 Urdu Q8 (میرا وطن) had a seven-sentence model answer under a question
 * asking ten to twelve. A short or long model paragraph is flagged, so its section is asked again.
 */

const { countSentences, paragraphLength, lengthNote } = require('../../bot/shared/services/assessment/fde-sentence-count');

const V26_Q8 = 'میرے وطن کا نام پاکستان ہے۔ یہ 14 اگست 1947 کو وجود میں آیا۔ اس کا دارالحکومت اسلام آباد ہے۔ پاکستان میں چار صوبے ہیں۔ اس کی قومی زبان اردو ہے۔ پاکستان کے لوگ بہت محنتی اور بہادر ہیں۔ مجھے اپنے وطن سے بہت محبت ہے۔';
const nSentences = (n) => Array.from({ length: n }, (_, i) => `یہ جملہ نمبر ${i + 1} ہے۔`).join(' ');
const exam = (items) => ({ unseen: { subjective: { 'Paragraph Writing': items } } });

describe('countSentences', () => {
  test('counts the sentences ending ۔ ؟ ! or .', () => {
    expect(countSentences(V26_Q8)).toBe(7);
    expect(countSentences('کیا آپ آئیں گے؟ جی ہاں! ٹھیک ہے۔ Yes.')).toBe(4);
  });
  test('a missing final stop still counts, blanks and lines do not', () => {
    expect(countSentences('پہلا جملہ۔ دوسرا جملہ')).toBe(2);
    expect(countSentences('  \n ')).toBe(0);
    expect(countSentences(null)).toBe(0);
  });
});

describe('paragraphLength: Q8 paragraph model answer must have 10 to 12 sentences', () => {
  test('the v26 seven-sentence answer is flagged on its slot', () => {
    const flags = paragraphLength(exam([{ slot: 'urdu.C.Q8', question: 'میرا وطن', answer: V26_Q8 }]));
    expect(flags).toEqual([expect.objectContaining({ slot: 'urdu.C.Q8', reason: 'length' })]);
    expect(flags[0].items[0]).toMatch(/7/);
  });
  test('10, 11 and 12 sentences pass; 13 is flagged', () => {
    [10, 11, 12].forEach((n) => expect(paragraphLength(exam([{ slot: 'urdu.C.Q8', question: 'میرا وطن', answer: nSentences(n) }]))).toEqual([]));
    expect(paragraphLength(exam([{ slot: 'urdu.C.Q8', question: 'میرا وطن', answer: nSentences(13) }]))).toHaveLength(1);
  });
  test('the dialogue item of Q8 and other slots are not read', () => {
    expect(paragraphLength(exam([{ slot: 'urdu.C.Q8', question: 'دو دوستوں کے درمیان وقت کی پابندی پر مکالمہ تحریر کریں۔', answer: 'علی: سلام۔' }]))).toEqual([]);
    expect(paragraphLength(exam([{ slot: 'urdu.C.Q9', question: 'کہانی', answer: 'ایک جملہ۔' }]))).toEqual([]);
  });
  test('never throws on garbage', () => {
    expect(paragraphLength(null)).toEqual([]);
    expect(paragraphLength({ unseen: { subjective: { 'Paragraph Writing': [null, {}] } } })).toEqual([]);
  });
});

describe('lengthNote', () => {
  test('tells the model the asked range and what it wrote', () => {
    const note = lengthNote(paragraphLength(exam([{ slot: 'urdu.C.Q8', question: 'میرا وطن', answer: V26_Q8 }])));
    expect(note).toMatch(/10 to 12 sentences/);
    expect(note).toContain('میرا وطن');
  });
  test('no length flag, no note', () => {
    expect(lengthNote([{ slot: 'x', reason: 'answer', items: [] }])).toBeNull();
  });
});
