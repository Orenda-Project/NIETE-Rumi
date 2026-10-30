/**
 * v29 G5 Urdu Q1 item 5 (blocker): the stem placed a city «outside Sidra's house» and two options (ہیروشیما, ناگاساکی)
 * were both true; item 4 had بوستان and گلستان, both books of حکایات. mcqTruthFlags flags the MCQ slot (a known-pairs
 * list plus one narrow stem-parse check, not generic detection).
 */

const { mcqTruthFlags } = require('../../bot/shared/services/assessment/fde-mcq-truth');
const urdu = require('./fixtures/fde-v34-g5-urdu-v29.json');
const english = require('./fixtures/fde-v34-g5-english-v29.json');

const paper = (list) => ({
  unseen: { x: { y: list } },
  _layout: { sections: [{ slots: [...new Set(list.map((q) => q.slot))].map((slot) => ({ slot, type: 'y' })) }] },
});
const mcq = (question, options, answer, slot = 'urdu.A.Q1') => ({ slot, question, options, answer });

describe('the real v29 G5 Urdu paper', () => {
  const flags = mcqTruthFlags(urdu);

  test('item 5 is flagged twice over: both-true options and a stem that does not parse', () => {
    expect(flags).toHaveLength(1);
    expect(flags[0].slot).toBe('urdu.A.Q1');
    expect(flags[0].reason).toBe('giveaway');
    expect(flags[0].words).toEqual(expect.arrayContaining(['گھر کے باہر کس شہر']));
    expect(flags[0].text.join(' ')).toMatch(/both true/);
  });

  test('item 4 (بوستان and گلستان) is named as a both-true pair', () => {
    expect(flags[0].words.join(' ')).toMatch(/بوستان/);
    expect(flags[0].words.join(' ')).toMatch(/ہیروشیما/);
  });

  test('the flag carries its own slot as `with`, so fde-answer-repeats re-asks the section', () => {
    expect(flags[0].with.every((s) => s === 'urdu.A.Q1')).toBe(true);
    expect(flags[0].text).toHaveLength(flags[0].with.length);
  });
});

describe('known pairs', () => {
  test('Hiroshima and Nagasaki beside an atom-bomb stem', () => {
    const f = mcqTruthFlags(paper([mcq('Which city was hit by an atom bomb in 1945?', ['a) Tokyo', 'b) Nagasaki', 'c) Osaka', 'd) Hiroshima'], 'd) Hiroshima', 'english.A.Q1a')]));
    expect(f).toHaveLength(1);
    expect(f[0].slot).toBe('english.A.Q1a');
  });

  test('a pair needs both names among the options', () => {
    expect(mcqTruthFlags(paper([mcq('کس شہر پر ایٹم بم گرا؟', ['الف) اوساکا', 'ب) ٹوکیو', 'ج) کراچی', 'د) ہیروشیما'], 'د) ہیروشیما')]))).toEqual([]);
  });

  test('a pair needs a stem on the shared fact', () => {
    expect(mcqTruthFlags(paper([mcq('ناگاساکی کس ملک میں ہے؟', ['الف) جاپان', 'ب) چین', 'ج) ہیروشیما', 'د) ناگاساکی'], 'الف) جاپان')]))).toEqual([]);
  });

  test('بوستان and گلستان beside a حکایات stem, diacritics ignored', () => {
    const f = mcqTruthFlags(paper([mcq('شیخ سعدی کی وہ کتاب جس میں حکایات ہیں؟', ['الف) بوستانِ', 'ب) گلستان', 'ج) کلیات', 'د) دیوان'], 'ب) گلستان')]));
    expect(f).toHaveLength(1);
  });

  test('English Q1(a) 14: should and could both give advice', () => {
    const f = mcqTruthFlags(english);
    expect(f).toHaveLength(1);
    expect(f[0].slot).toBe('english.A.Q1a');
    expect(f[0].words).toEqual(['should / could']);
    expect(f[0].text.join(' ')).toMatch(/modal verb that gives advice/);
  });

  test('a modal stem that is not about advice is left alone', () => {
    expect(mcqTruthFlags(paper([mcq('Choose the modal verb for a rule: You ___ stop at a red light.', ['a) must', 'b) might', 'c) should', 'd) could'], 'a) must', 'english.A.Q1a')]))).toEqual([]);
  });
});

describe('stem parse', () => {
  const stem = (q) => mcqTruthFlags(paper([mcq(q, ['الف) لاہور', 'ب) کراچی', 'ج) ملتان', 'د) پشاور'], 'الف) لاہور')]));

  test('a city asked outside a house is flagged', () => {
    expect(stem('سدرہ کے گھر کے باہر کس شہر پر ایٹم بم کا حملہ ہوا؟')).toHaveLength(1);
    expect(stem('علی کے اسکول کے سامنے کون سے ملک کا جھنڈا لگا تھا؟')).toHaveLength(1);
  });

  test('a clean stem naming the person only is not flagged', () => {
    expect(stem('سدرہ نے کس شہر پر ایٹم بم کے حملے کے بارے میں پڑھا؟')).toEqual([]);
    expect(stem('پاکستان کا سب سے بڑا شہر کون سا ہے؟')).toEqual([]);
  });

  test('a locative before a non-place question word is left alone', () => {
    expect(stem('سدرہ کے گھر کے باہر کون سا درخت لگا ہے؟')).toEqual([]);
  });

  test('never throws on a missing paper or an item without a stem', () => {
    expect(mcqTruthFlags(null)).toEqual([]);
    expect(mcqTruthFlags(paper([{ slot: 'urdu.A.Q1', options: ['a', 'b'], answer: 'a' }]))).toEqual([]);
  });
});
