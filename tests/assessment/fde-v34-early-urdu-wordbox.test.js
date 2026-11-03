/**
 * v29 blocker, G1 Urdu Q5 (bd-5jmnfj.4.58): «میری ایک ___ ہے۔» and «بنٹی کی ___ گم ہو گئی تھی۔» both take بہن and
 * گڑیا from the word box, and the key paid one word each. A word-box blank must be fillable by one box word only.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { boxClashes, wordBoxFix, fits } = require('../../bot/shared/services/assessment/fde-early-urdu-wordbox');
const { answerNote } = require('../../bot/shared/services/assessment/fde-early-prompt');
const { earlyUrduFixes } = require('../../bot/shared/services/assessment/fde-early-urdu-fixes');

const P = Patterns.subjectOf('fde_g1_2026', 'urdu');
const BOX = ['ستارے', 'خوشبو', 'بہن', 'سال', 'گڑیا'];
const item = (question, answer, extra = {}) => ({
  slot: 'g1.urdu.B.Q5', main_question: 'خالی جگہ دیے گئے الفاظ میں سے درست لفظ سے بھریں', question, answer, marks: 1,
  scheme: { points: [{ text: 'درست لفظ لکھنا', marks: 1, kind: 'K' }], accept: [answer], common_error: 'غلط لفظ منتخب کرنا' }, ...extra,
});
const v29 = () => [
  item('چاند کے ساتھ ___ آئے۔', 'ستارے', { words: BOX }),
  item('مٹھائیوں کی ___ آئی۔', 'خوشبو'),
  item('میری ایک ___ ہے۔', 'بہن'),
  item('میں سات ___ کا ہوں۔', 'سال'),
  item('بنٹی کی ___ گم ہو گئی تھی۔', 'گڑیا'),
];
const paper = (items) => ({
  unseen: { subjective: { 'Fill in the Blanks': items } },
  _layout: { sections: [{ id: 'B', slots: [{ slot: 'g1.urdu.B.Q5', type: 'Fill in the Blanks' }] }] },
});
const items = (ex) => ex.unseen.subjective['Fill in the Blanks'];

describe('word box fit (gender and number from the key frames)', () => {
  test('a feminine word fits a feminine open frame, not a masculine one', () => {
    expect(fits(paper(v29()), 'گڑیا', 'میری ایک ___ ہے۔')).toBe(true);
    expect(fits(paper(v29()), 'گڑیا', 'میں سات ___ کا ہوں۔')).toBe(false);
  });
  test('a frame with its own context words is closed', () => {
    expect(fits(paper(v29()), 'بہن', 'چاند کے ساتھ ___ آئے۔')).toBe(false);
    expect(fits(paper(v29()), 'بہن', 'مٹھائیوں کی ___ آئی۔')).toBe(false);
  });
});

describe('G1 Urdu Q5 clash', () => {
  test('RED v29: بہن and گڑیا each fit the other blank and are flagged as an answer shortfall', () => {
    const flags = boxClashes(paper(v29()), P);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ slot: 'g1.urdu.B.Q5', reason: 'answer' });
    expect(flags[0].items.join(' ')).toMatch(/بہن/);
    expect(flags[0].items.join(' ')).toMatch(/گڑیا/);
  });
  test('the flags are the shape the writer re-asks on: answerNote turns them into a note with the slot rule', () => {
    const note = answerNote(boxClashes(paper(v29()), P), P);
    expect(note).toMatch(/only ONE box word fits/);
    expect(note).toMatch(/گڑیا/);
  });
  test('a box whose open blank only one word fits is not flagged', () => {
    const ok = [v29()[0], v29()[1], v29()[3]];
    ok[0] = { ...ok[0], words: ['ستارے', 'خوشبو', 'سال'] };
    expect(boxClashes(paper(ok), P)).toEqual([]);
  });
  test('if it ships, both words are accepted in both keys with a note', () => {
    const { examJson, notes } = wordBoxFix(paper(v29()));
    const [, , iii, , v] = items(examJson);
    expect(iii.scheme.accept).toEqual(expect.arrayContaining(['بہن', 'گڑیا']));
    expect(v.scheme.accept).toEqual(expect.arrayContaining(['بہن', 'گڑیا']));
    expect(items(examJson)[0].scheme.accept).toEqual(['ستارے']);
    expect(notes.join(' ')).toMatch(/g1\.urdu\.B\.Q5/);
  });
  test('earlyUrduFixes applies the accept fix', () => {
    expect(items(earlyUrduFixes(paper(v29())).examJson)[2].scheme.accept).toContain('گڑیا');
  });
  test('the slot rule asks for blanks only one box word fits', () => {
    const rule = P.sections.flatMap((s) => s.slots).find((s) => s.slot === 'g1.urdu.B.Q5').prompt_rule;
    expect(rule).toMatch(/only ONE box word fits/);
  });
});
