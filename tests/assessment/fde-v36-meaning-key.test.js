/**
 * bd-5jmnfj.33 v33 BLOCKER — G3 General Knowledge ch3 Q4 v asks what «چنیں» means and keys a sentence quoted
 * from the book's steps; its 2-mark point pays the next step (tell an elder), not the meaning.
 * Pure data in, flags out; the v33 item is the fixture. P = { g5_rules: false } is a Grade 3-4 paper.
 */

const { meaningKeyShortfall, meaningKeyNote } = require('../../bot/shared/services/assessment/fde-meaning-key');

const P = { g5_rules: false };
const BOOK = 'مسئلے کے حل کے مراحل: رکیں، سوچیں، چنیں۔ اگر آپ مطمئن نہ ہوں تو انتخاب کریں۔ مسئلے کے حل کے لیے کسی بڑے سے کہیں۔ پھر عمل کریں۔';
const exam = (item) => ({ _layout: { subject: 'General Knowledge', sections: [] }, unseen: { subjective: { 'Short Answers': [item] } } });
const item = (question, answer, points, marks = 3, slot = 'g3.general_knowledge.C.short') => ({
  slot, question, answer, marks, scheme: { points: points.map(([text, m]) => ({ text, marks: m, kind: 'K' })), accept: [], common_error: '' },
});

const V33 = item('مسئلے کے حل کے طریقے میں "چنیں" کا کیا مطلب ہے؟',
  'اگر آپ مطمئن نہ ہوں تو انتخاب کریں۔ مسئلے کے حل کے لیے کسی بڑے سے کہیں۔',
  [['مطمئن نہ ہونے پر انتخاب کرنا', 1], ['مسئلہ حل کرنے کے لیے کسی بڑے کے پاس جانا', 2]]);

describe('a meaning question keyed on the book or on other steps', () => {
  test('the v33 item is flagged for quoting the book and for splitting 3 marks over two points', () => {
    const [f] = meaningKeyShortfall(exam(V33), P, BOOK);
    expect(f).toMatchObject({ slot: 'g3.general_knowledge.C.short', reason: 'meaning_key' });
    expect(f.why).toEqual(expect.arrayContaining(['quotes_book', 'split_marks']));
    expect(f.why).not.toContain('repeats_word');
    expect(f.line).toContain(V33.question);
    expect(f.line).toContain(V33.answer);
  });

  test('a sound meaning item (one 3-mark point, not in the book) is not flagged', () => {
    const ok = item('"بہادر" کا کیا مطلب ہے؟', 'جو ڈرتا نہیں', [['جو ڈرتا نہیں', 3]]);
    expect(meaningKeyShortfall(exam(ok), P, BOOK)).toEqual([]);
  });

  test('a quote of 24+ characters in a point text alone flags the item', () => {
    const q = item('"چنیں" سے کیا مراد ہے؟', 'حل چن لینا', [['اگر آپ مطمئن نہ ہوں تو انتخاب کریں', 3]]);
    expect(meaningKeyShortfall(exam(q), P, BOOK)[0].why).toEqual(['quotes_book']);
  });

  test('the shingle is whitespace-collapsed and NFC: spacing in the key does not hide the quote', () => {
    const q = item('"چنیں" کا مطلب؟', 'اگر  آپ\nمطمئن نہ ہوں تو انتخاب کریں', [['حل چن لینا', 3]]);
    expect(meaningKeyShortfall(exam(q), P, BOOK)[0].why).toContain('quotes_book');
  });

  test('a short answer that shares fewer than 24 characters with the book is not a quote', () => {
    const q = item('"چنیں" کا کیا مطلب ہے؟', 'مطمئن نہ ہوں تو چن لیں', [['حل چن لینا', 3]]);
    expect(meaningKeyShortfall(exam(q), P, BOOK)).toEqual([]);
  });

  test('two points on a 3-mark meaning flag; two points on a 4-mark item do not', () => {
    const two = [['پہلا خیال', 1], ['دوسرا خیال', 2]];
    expect(meaningKeyShortfall(exam(item('"بہادر" کا کیا مطلب ہے؟', 'جو ڈرتا نہیں', two, 3)), P, '')[0].why).toEqual(['split_marks']);
    expect(meaningKeyShortfall(exam(item('"بہادر" کا کیا مطلب ہے؟', 'جو ڈرتا نہیں', two, 4)), P, '')).toEqual([]);
  });

  test('a point that repeats the asked word is circular', () => {
    const q = item('"چنیں" کا کیا مطلب ہے؟', 'حل چن لینا', [['چنیں کا مطلب چننا ہے', 3]]);
    expect(meaningKeyShortfall(exam(q), P, '')[0].why).toEqual(['repeats_word']);
  });

  test.each([
    ['X کا مطلب', 'بہادر کا مطلب لکھیں۔'],
    ['X سے کیا مراد', 'بہادر سے کیا مراد ہے؟'],
    ['X کے معنی', 'بہادر کے معنی لکھیں۔'],
    ['what does X mean', 'What does brave mean?'],
    ['meaning of X', 'Write the meaning of brave.'],
  ])('recognises the stem shape %s', (_n, question) => {
    const q = item(question, 'x', [['a', 1], ['b', 2]]);
    expect(meaningKeyShortfall(exam(q), P, '')[0].why).toContain('split_marks');
  });

  test('a stem that is not a meaning question is left alone', () => {
    const q = item('مسئلے کے حل کے تین مراحل لکھیں۔', 'رکیں، سوچیں، چنیں', [['رکیں', 1], ['سوچیں', 1], ['چنیں', 1]]);
    expect(meaningKeyShortfall(exam(q), P, 'رکیں، سوچیں، چنیں')).toEqual([]);
  });

  test('a paper that is not Grade 3-4 (g5_rules true) is left alone', () => {
    expect(meaningKeyShortfall(exam(V33), { g5_rules: true }, BOOK)).toEqual([]);
  });

  test('no exam or no book text does not throw', () => {
    expect(meaningKeyShortfall(null, P, BOOK)).toEqual([]);
    expect(meaningKeyShortfall(exam(V33), P, undefined)[0].why).toEqual(['split_marks']);
  });
});

describe('the re-ask note', () => {
  test('names the item, why, and the instruction', () => {
    const note = meaningKeyNote(meaningKeyShortfall(exam(V33), P, BOOK));
    expect(note).toContain(V33.question);
    expect(note).toContain('give the meaning in the child\'s words as one point for the full marks');
  });
  test('is null when no meaning_key flag is present', () => {
    expect(meaningKeyNote([{ slot: 's', reason: 'giveaway' }])).toBeNull();
    expect(meaningKeyNote(undefined)).toBeNull();
  });
});
