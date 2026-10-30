/**
 * bd-5jmnfj.33 v33 reader defects: a fill-in-the-blanks word box that holds exactly the answers is a giveaway.
 * G3 General Knowledge Q3 boxed ten words for ten blanks (shuffled, but no distractor); G4 Science Q2 boxed five
 * words for five blanks, in blank order. The box lives in `words` on the first item of the fill slot.
 * fde-key-checks only asks that every answer is in the box; nothing asks for a word that fits no blank.
 */

const { wordBoxShortfall, wordBoxNote } = require('../../bot/shared/services/assessment/fde-word-box');

const P = { g5_rules: false };
const exam = (items) => ({ _layout: { subject: 'x', sections: [] }, unseen: { objective: { 'Fill in the Blanks': items } } });
const fill = (slot, rows, box) => rows.map(([question, answer], i) => ({
  slot, main_question: 'Fill in the blanks with the correct word.', question, answer, marks: 1, lines: 1, ...(i === 0 && box ? { words: box } : {}),
}));

const G4_SLOT = 'g4.science.A.fill';
const G4_ROWS = [
  ['Steam is water in its ___________ state.', 'gas'],
  ['A material that does not let electricity pass through easily is called a/an ___________.', 'insulator'],
  ['Wires are usually made of aluminium or ___________ because they carry electricity well.', 'copper'],
  ['When water loses energy and its particles slow down and settle into fixed positions, the change is called ___________.', 'freezing'],
  ['A stone dropped in a pond ___________ because it is more dense than water.', 'sinks'],
];
const G4_BOX = ['gas', 'insulator', 'copper', 'freezing', 'sinks'];

const G3_SLOT = 'g3.general_knowledge.A.fill';
const G3_ROWS = [
  ['دوسروں کی رائے کا ___________ نہ کرنا اختلاف کی ایک وجہ ہے۔', 'احترام'],
  ['اچھے طریقے سے ___________ ادا نہ کرنا اختلاف کی ایک وجہ ہے۔', 'فرائض'],
  ['___________ کا پورا نہ ہونا اختلاف کی ایک وجہ ہے۔', 'خواہشات'],
  ['ایک چیز کو ___________ اور دوسرے کو ناپسند کرنا اختلاف کی وجہ بن سکتا ہے۔', 'پسند'],
  ['اختلاف ہماری ___________ زندگی کا حصہ ہے۔', 'روزمرہ'],
  ['___________ میں طلبہ کے درمیان بیٹھنے کی جگہوں پر اختلاف ہو جاتا ہے۔', 'جماعت'],
  ['چیزوں کے استعمال اور ___________ پر اختلاف ہو جاتا ہے۔', 'ملکیت'],
  ['دو ساتھی ایک کھلونے پر بحث کر رہے ہیں۔ انہیں ایک دوسرے کی بات ___________ سے سننی چاہیے۔', 'غور'],
  ['مثبت انداز میں سوچیں کہ ہم ایک دوسرے کی ___________ کیسے کر سکتے ہیں۔', 'مدد'],
  ['سب سے اہم بات یہ ہے کہ ہم اختلافات سے ___________۔', 'بچیں'],
];
const G3_BOX = ['مدد', 'جماعت', 'فرائض', 'پسند', 'بچیں', 'احترام', 'ملکیت', 'غور', 'روزمرہ', 'خواہشات'];

describe('a fill-in-the-blanks word box with no distractor or in blank order', () => {
  test('the v33 G4 Science box (five words, five blanks, blank order) is flagged twice', () => {
    const flags = wordBoxShortfall(exam(fill(G4_SLOT, G4_ROWS, G4_BOX)), P);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ slot: G4_SLOT, reason: 'word_box' });
    expect(flags[0].why).toEqual(expect.arrayContaining(['no_distractor', 'box_in_order']));
    expect(flags[0].text).toEqual([G4_ROWS[0][0]]);
    expect(flags[0].line).toContain(G4_ROWS[0][0]);
    expect(flags[0].line).toContain('insulator');
  });

  test('the v33 G3 GK box (ten words, ten blanks, shuffled) is flagged for no distractor only', () => {
    const flags = wordBoxShortfall(exam(fill(G3_SLOT, G3_ROWS, G3_BOX)), P);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ slot: G3_SLOT, reason: 'word_box', why: ['no_distractor'] });
    expect(flags[0].text).toEqual([G3_ROWS[0][0]]);
    expect(flags[0].line).toContain('خواہشات');
  });

  test('one distractor and a shuffled box is clean', () => {
    const box = ['copper', 'sinks', 'gas', 'liquid', 'freezing', 'insulator'];
    expect(wordBoxShortfall(exam(fill(G4_SLOT, G4_ROWS, box)), P)).toEqual([]);
    expect(wordBoxShortfall(exam(fill(G3_SLOT, G3_ROWS, [...G3_BOX, 'درخت'])), P)).toEqual([]);
  });

  test('a distractor does not excuse a box whose answers still sit in blank order', () => {
    const box = ['gas', 'insulator', 'liquid', 'copper', 'freezing', 'sinks'];
    const flags = wordBoxShortfall(exam(fill(G4_SLOT, G4_ROWS, box)), P);
    expect(flags).toHaveLength(1);
    expect(flags[0].why).toEqual(['box_in_order']);
  });

  test('two extra words and a shuffled box is clean; fewer words than blanks is still flagged', () => {
    const box = ['sinks', 'copper', 'gas', 'liquid', 'freezing', 'insulator', 'steel'];
    expect(wordBoxShortfall(exam(fill(G4_SLOT, G4_ROWS, box)), P)).toEqual([]);
    const short = ['sinks', 'copper', 'gas', 'insulator'];
    expect(wordBoxShortfall(exam(fill(G4_SLOT, G4_ROWS, short)), P)[0].why).toContain('no_distractor');
  });

  test('matching ignores case, spaces and diacritics between the box and the answers', () => {
    const rows = [['Steam is a ___.', 'Gas'], ['Metal wire is ___.', 'copper']];
    const flags = wordBoxShortfall(exam(fill(G4_SLOT, rows, [' gas', 'Copper'])), P);
    expect(flags[0].why).toEqual(['no_distractor', 'box_in_order']);
    const ur = wordBoxShortfall(exam(fill(G3_SLOT, G3_ROWS.slice(0, 2), ['فَرائض', 'احترام'])), P);
    expect(ur[0].why).toEqual(['no_distractor']);
  });

  test('a single blank cannot be out of order, so only the distractor rule applies', () => {
    const one = [G4_ROWS[0]];
    expect(wordBoxShortfall(exam(fill(G4_SLOT, one, ['gas'])), P)[0].why).toEqual(['no_distractor']);
    expect(wordBoxShortfall(exam(fill(G4_SLOT, one, ['gas', 'liquid'])), P)).toEqual([]);
  });

  test('two fill slots are judged separately, each by its own box', () => {
    const other = fill('g4.science.B.fill', G4_ROWS.slice(0, 2), ['insulator', 'steel', 'gas']);
    const flags = wordBoxShortfall(exam([...fill(G4_SLOT, G4_ROWS, G4_BOX), ...other]), P);
    expect(flags.map((f) => f.slot)).toEqual([G4_SLOT]);
  });
});

describe('papers the check leaves alone', () => {
  test('a fill slot with no word box, an MCQ and a paper with no items are clean', () => {
    expect(wordBoxShortfall(exam(fill(G4_SLOT, G4_ROWS, null)), P)).toEqual([]);
    const mcq = { slot: 's', question: 'Q?', options: ['a) x', 'b) y'], answer: 'a) x', words: ['x', 'y'] };
    expect(wordBoxShortfall({ unseen: { objective: { MCQs: [mcq] } } }, P)).toEqual([]);
    expect(wordBoxShortfall({ unseen: {} }, P)).toEqual([]);
    expect(wordBoxShortfall({}, P)).toEqual([]);
  });

  test('a Grade 5 paper, a missing P and a null exam never throw and return nothing', () => {
    const e = exam(fill(G4_SLOT, G4_ROWS, G4_BOX));
    expect(wordBoxShortfall(e, { g5_rules: true })).toEqual([]);
    expect(wordBoxShortfall(e, undefined)).toEqual([]);
    expect(wordBoxShortfall(null, P)).toEqual([]);
    expect(wordBoxShortfall(undefined, undefined)).toEqual([]);
  });

  test('a malformed box or item does not throw', () => {
    const odd = [{ slot: G4_SLOT, question: 'q', answer: null, words: 'gas' }, null, { slot: G4_SLOT, words: [null, 3] }];
    expect(() => wordBoxShortfall(exam(odd), P)).not.toThrow();
  });
});

describe('the re-ask note', () => {
  test('names each question and asks for one extra word that fits no blank', () => {
    const both = [...fill(G4_SLOT, G4_ROWS, G4_BOX), ...fill(G3_SLOT, G3_ROWS, G3_BOX)];
    const note = wordBoxNote(wordBoxShortfall(exam(both), P));
    expect(note).toContain(G4_ROWS[0][0]);
    expect(note).toContain(G3_ROWS[0][0]);
    expect(note).toMatch(/at least one extra word/i);
    expect(note).toMatch(/fits none of the blanks/i);
  });

  test('is null when no word_box flag is present', () => {
    expect(wordBoxNote([{ slot: 's', reason: 'giveaway' }])).toBeNull();
    expect(wordBoxNote([])).toBeNull();
    expect(wordBoxNote(undefined)).toBeNull();
    expect(wordBoxNote(null)).toBeNull();
  });
});
