/**
 * v34 Grade 1-2 defects the reader found, pinned for fde-early-dupes (pure, pattern in, flags out):
 *  - G2 English Q3 i: the accept line read «bun», «run is not allowed», «gun», «nun». An accept entry is one answer.
 *  - G2 Urdu asked the opposite of «دن» twice (Q1 v and Q6) and printed «رانی بازار جائے گی۔» in Q1 ix and Q4 ii.
 * Strings are quoted from the v34 g2-english-exam.json and g2-urdu-exam.json.
 */

const { acceptProseShortfall, dupeShortfall, earlyDupeShortfall } = require('../../bot/shared/services/assessment/fde-early-dupes');

const P_EN = { key: 'g2-english', sections: [{ id: 'B', slots: [{ slot: 'g2.english.B.Q3', type: 'Rhyming Pairs' }] }] };
const P_UR = {
  key: 'g2-urdu',
  sections: [{ id: 'A', slots: [
    { slot: 'g2.urdu.A.Q1', type: 'MCQs', shape: 'mcq' },
    { slot: 'g2.urdu.A.Q4', type: 'Verbs' },
    { slot: 'g2.urdu.A.Q6', type: 'Opposites' },
  ] }],
};

const rhyme = (question, answer, accept, points) => ({
  slot: 'g2.english.B.Q3', question, answer, marks: 1,
  scheme: { points: points || [{ text: 'A real word that rhymes with sun', marks: 1, kind: 'K' }], accept, common_error: 'Writing a real word that does not rhyme, such as sand', checked: null },
});
const sun = (accept, points) => rhyme('Write a word that rhymes with sun.', 'fun', accept, points);
const bag = rhyme('Write a word that rhymes with bag.', 'tag', ['flag', 'wag', 'rag', 'nag'], [{ text: 'A real word that rhymes with bag', marks: 1, kind: 'K' }]);
const enExam = (...items) => ({ unseen: { subjective: { 'Rhyming Pairs': items } } });

const opp = (word) => ({ slot: 'g2.urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: `لفظ «${word}» کا الٹ کون سا لفظ ہے؟`, options: ['الف) صبح', 'ب) شام', 'ج) رات'], answer: 'ج) رات', marks: 1 });
const Q1_V = opp('دن');
const Q1_EASY = { ...opp('آسان'), options: ['الف) مشکل', 'ب) ہلکا', 'ج) اچھا'], answer: 'الف) مشکل' };
const Q1_IX = { slot: 'g2.urdu.A.Q1', question: 'جملہ «رانی بازار جائے گی۔» کس زمانے کا ہے؟', options: ['الف) حال', 'ب) مستقبل', 'ج) ماضی'], answer: 'ب) مستقبل', marks: 1 };
const Q4_II = { slot: 'g2.urdu.A.Q4', question: 'رانی بازار جائے گی۔', answer: 'جائے گی', marks: 1, scheme: { points: [{ text: 'درست فعل', marks: 1, kind: 'A' }], accept: ['جائے'], common_error: 'بازار لکھنا', checked: null } };
const q6 = (word, answer, accept) => ({ slot: 'g2.urdu.A.Q6', main_question: 'دیے گئے الفاظ کے متضاد لکھیں', question: word, answer, marks: 1, scheme: { points: [{ text: 'درست متضاد', marks: 1, kind: 'A' }], accept: accept || [answer], common_error: 'شام لکھنا', checked: null } });
const Q6_DAY = q6('دن', 'رات');
const Q6_IN = q6('اندر', 'باہر');
const Q6_WHITE = q6('سفید', 'سیاہ', ['سیاہ', 'کالا']);
const urExam = (mcqs, subj) => ({ unseen: { objective: { MCQs: mcqs }, subjective: { Verbs: subj.filter((q) => q.slot.endsWith('Q4')), Opposites: subj.filter((q) => q.slot.endsWith('Q6')) } } });

describe('acceptProseShortfall', () => {
  test('the v34 line with «run is not allowed» is flagged, naming the entry', () => {
    const flags = acceptProseShortfall(enExam(sun(['bun', 'run is not allowed', 'gun', 'nun']), bag), P_EN);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ slot: 'g2.english.B.Q3', reason: 'answer' });
    expect(flags[0].items).toHaveLength(1);
    expect(flags[0].items[0]).toContain('run is not allowed');
    expect(flags[0].items[0]).toContain('Write a word that rhymes with sun.');
  });
  test('the sibling item with a clean accept line is not flagged', () => {
    const flags = acceptProseShortfall(enExam(sun(['bun', 'run is not allowed', 'gun', 'nun']), bag), P_EN);
    expect(flags[0].items.join(' ')).not.toContain('bag');
  });
  test('an entry joining answers with a semicolon is flagged', () => {
    const flags = acceptProseShortfall(enExam(sun(['bun; gun', 'nun'])), P_EN);
    expect(flags).toHaveLength(1);
    expect(flags[0].items[0]).toContain('bun; gun');
  });
  test('the old joined form «bun; run is not allowed; gun; nun» is one flagged entry', () => {
    const flags = acceptProseShortfall(enExam(sun(['bun; run is not allowed; gun; nun'])), P_EN);
    expect(flags).toHaveLength(1);
    expect(flags[0].items).toHaveLength(1);
  });
  test.each(['run is not accepted', 'wrong', 'not allowed: run'])('a negation entry «%s» is flagged', (entry) => {
    expect(acceptProseShortfall(enExam(sun(['bun', entry])), P_EN)).toHaveLength(1);
  });
  test('an explanatory entry far longer than the answer is flagged', () => {
    const entry = 'any word that ends with the same sound as sun when you say it aloud';
    expect(acceptProseShortfall(enExam(sun(['bun', entry])), P_EN)).toHaveLength(1);
  });
  test('a one-word answer whose points text carries prose is flagged; a rubric on a long answer is not', () => {
    const prose = [{ text: 'bun; gun; run is not allowed', marks: 1, kind: 'K' }];
    expect(acceptProseShortfall(enExam(sun(['bun', 'gun'], prose)), P_EN)).toHaveLength(1);
    const long = { ...sun(['bun']), answer: 'The sun is hot.', scheme: { points: [{ text: 'A full sentence; capital letter; full stop', marks: 2, kind: 'K' }], accept: ['The sun is hot.'] } };
    expect(acceptProseShortfall(enExam(long), P_EN)).toEqual([]);
  });
  test('Urdu one-word accept entries and the real Q6 «سیاہ، کالا» line are clean', () => {
    expect(acceptProseShortfall(urExam([Q1_V], [Q6_WHITE, Q6_DAY, Q4_II]), P_UR)).toEqual([]);
  });
  test('a hyphen or apostrophe inside one answer is clean', () => {
    expect(acceptProseShortfall(enExam(sun(['well-known', "o'clock"])), P_EN)).toEqual([]);
  });
});

describe('dupeShortfall, repeated target word', () => {
  const flags = dupeShortfall(urExam([Q1_EASY, Q1_V, Q1_IX], [Q4_II, Q6_IN, Q6_DAY]), P_UR);
  test('«دن» asked in Q1 v and again in Q6 is flagged on the later item', () => {
    const f = flags.find((x) => x.slot === 'g2.urdu.A.Q6');
    expect(f).toMatchObject({ reason: 'answer' });
    expect(f.items.some((s) => s.includes('دن'))).toBe(true);
  });
  test('the first asking (Q1) is not the item flagged for the word', () => {
    expect(flags.filter((x) => x.slot === 'g2.urdu.A.Q1')).toEqual([]);
  });
  test('«آسان» and «اندر» are asked once each and are not named', () => {
    const text = flags.flatMap((f) => f.items).join(' ');
    expect(text).not.toContain('آسان');
    expect(text).not.toContain('اندر');
  });
  test('a diacritic or punctuation change in the stem word still counts as the same word', () => {
    const marked = { ...Q6_DAY, question: 'دَن۔' };
    expect(dupeShortfall(urExam([Q1_V], [marked]), P_UR).map((f) => f.slot)).toContain('g2.urdu.A.Q6');
  });
});

describe('dupeShortfall, repeated sentence', () => {
  const flags = dupeShortfall(urExam([Q1_IX], [Q4_II]), P_UR);
  test('«رانی بازار جائے گی۔» in Q1 ix and Q4 ii is flagged on Q4', () => {
    expect(flags).toHaveLength(1);
    expect(flags[0].slot).toBe('g2.urdu.A.Q4');
    expect(flags[0].items[0]).toContain('رانی بازار جائے گی');
  });
  test('whitespace and the closing stop do not hide the repeat', () => {
    const spaced = { ...Q4_II, question: '  رانی  بازار جائے گی ' };
    expect(dupeShortfall(urExam([Q1_IX], [spaced]), P_UR)).toHaveLength(1);
  });
  test('a sentence repeated in an answer or a sub-question of another item counts', () => {
    const asker = { slot: 'g2.urdu.A.Q4', question: 'ہر جملہ پڑھیں', questions: ['رانی بازار جائے گی۔'], answer: 'x', marks: 1 };
    expect(dupeShortfall(urExam([Q1_IX], [asker]), P_UR)).toHaveLength(1);
  });
  test('the same sentence twice inside one item is not a cross-item repeat', () => {
    const one = { slot: 'g2.urdu.A.Q4', question: 'رانی بازار جائے گی۔', answer: 'رانی بازار جائے گی۔', marks: 1 };
    expect(dupeShortfall(urExam([], [one]), P_UR)).toEqual([]);
  });
});

describe('earlyDupeShortfall', () => {
  test('is the accept flags then the dupe flags, in the keyShortfall shape', () => {
    const exam = urExam([Q1_V, Q1_IX], [Q4_II, Q6_DAY]);
    const all = earlyDupeShortfall(exam, P_UR);
    expect(all).toEqual([...acceptProseShortfall(exam, P_UR), ...dupeShortfall(exam, P_UR)]);
    expect(all.map((f) => f.slot).sort()).toEqual(['g2.urdu.A.Q4', 'g2.urdu.A.Q6']);
    all.forEach((f) => { expect(f.reason).toBe('answer'); f.items.forEach((s) => expect(typeof s).toBe('string')); });
  });
  test('the English accept flag comes through the combined call', () => {
    expect(earlyDupeShortfall(enExam(sun(['bun', 'run is not allowed'])), P_EN)).toHaveLength(1);
  });
  test('a clean paper returns []', () => {
    expect(earlyDupeShortfall(urExam([Q1_EASY, Q1_V], [Q4_II, Q6_IN, Q6_WHITE]), P_UR)).toEqual([]);
  });
  test('items whose slot is not in the pattern are ignored', () => {
    const stray = { ...Q6_DAY, slot: 'g2.urdu.Z.Q9' };
    expect(earlyDupeShortfall(urExam([Q1_V], [stray]), P_UR)).toEqual([]);
  });
  test('null, empty, missing scheme and missing pattern never throw', () => {
    [null, undefined, {}, { unseen: null }, { unseen: { subjective: { X: [null, {}, { slot: 'g2.urdu.A.Q6' }] } } }].forEach((e) => {
      expect(() => earlyDupeShortfall(e, P_UR)).not.toThrow();
      expect(earlyDupeShortfall(e, P_UR)).toEqual([]);
    });
    expect(() => earlyDupeShortfall(enExam(sun(['bun'])), null)).not.toThrow();
    expect(earlyDupeShortfall(enExam({ slot: 'g2.english.B.Q3', question: 'q', answer: 'a' }), P_EN)).toEqual([]);
  });
});
