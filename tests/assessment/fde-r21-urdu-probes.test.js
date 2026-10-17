/**
 * Probes for the Urdu Q1 rules (story-name cue, the key's letters, one grammar concept once).
 * Each probe swaps one or two Q1 items of a recorded sandbox paper (full_2) and reads what prints.
 * Expectations marked DOC record today's behaviour where the brief allows either reading.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const read = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r21-urdu-sandbox-full_2.json'), 'utf8'));
function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const mcq = (question, options, answer) => ({ question, options, answer, marks: 1 });
// full_2 with Q1 items at `at` (story facts that ask no grammar concept: پنکی، ببلو) replaced.
function paper(swaps, reasked = false) {
  const exam = read();
  const q1 = items(exam, 'urdu.A.Q1');
  const at = [3, 5];
  swaps.forEach((s, i) => Object.assign(q1[at[i]], s));
  const laid = applyLayout(exam, U, FDE, { reasked });
  return { stems: items(laid.examJson, 'urdu.A.Q1').map((q) => q.question), laid };
}

describe('the key\'s letters', () => {
  test('a find-the-part item whose example sentence holds the key stays («اگر … تو» → اگر)', () => {
    const s = '«اگر بارش ہوئی تو ہم گھر رہیں گے» میں حرفِ شرط کون سا ہے؟';
    expect(paper([mcq(s, ['الف) اگر', 'ب) بارش', 'ج) گھر', 'د) رہیں'], 'الف) اگر')]).stems).toContain(s);
  });
  test('an antonym stays («دن» → رات)', () => {
    const s = 'لفظ «دن» کا متضاد کیا ہے؟';
    expect(paper([mcq(s, ['الف) صبح', 'ب) رات', 'ج) شام', 'د) دوپہر'], 'ب) رات')]).stems).toContain(s);
  });
  test('DOC: a singular asked from its plural, beside unrelated distractors, is held («کتابیں» → کتاب)', () => {
    const s = 'لفظ «کتابیں» کا واحد کیا ہے؟';
    expect(paper([mcq(s, ['الف) کتاب', 'ب) قلم', 'ج) کاپی', 'د) بستہ'], 'الف) کتاب')]).stems).not.toContain(s);
  });
  test('DOC: the same item with inflected distractors stays («کتابوں», «کتابی»)', () => {
    const s = 'لفظ «کتابیں» کا واحد کیا ہے؟';
    expect(paper([mcq(s, ['الف) کتاب', 'ب) کتابوں', 'ج) کتابی', 'د) کتب'], 'الف) کتاب')]).stems).toContain(s);
  });
  test('malformed items never throw (null stem, number and object options, an index key)', () => {
    expect(() => paper([mcq(null, [null, 3, {}, 'د) کتاب'], 2), mcq('«بن» کیا ہے؟', 'not a list', null)])).not.toThrow();
  });
});

describe('one grammar concept once', () => {
  test('a word-meaning item whose key is «آرزو» asks no grammar concept: it prints beside the تمنائی item', () => {
    const s = 'لفظ «تمنا» کا درست مطلب کیا ہے؟';
    const { stems } = paper([mcq(s, ['الف) آرزو', 'ب) غصہ', 'ج) خوف', 'د) تھکن'], 'الف) آرزو')]);
    expect(stems).toContain(s);
    expect(stems).toContain('کون سا جملہ دل کی کوئی آرزو ظاہر کرتا ہے؟');
  });
  test('a story stem that says «جوڑنے» asks no conjunction: it prints beside the حرفِ عطف item', () => {
    const s = 'ببلو نے ٹوٹی ہوئی پتنگ جوڑنے کے لیے کیا استعمال کیا؟';
    const { stems } = paper([mcq(s, ['الف) گوند', 'ب) دھاگا', 'ج) کیل', 'د) رسی'], 'الف) گوند')]);
    expect(stems).toContain(s);
  });
  test('RED: two تمنائی items and the آرزو item ask one concept: at most one of the three prints', () => {
    const a = 'کون سا جملہ تمنائی ہے؟';
    const b = 'تمنائی جملوں میں کون سا لفظ استعمال ہوتا ہے؟';
    const { stems } = paper([mcq(a, ['الف) کاش میں اڑ سکتا', 'ب) وہ گیا', 'ج) کیا تم آؤ گے', 'د) بیٹھ جاؤ'], 'الف) کاش میں اڑ سکتا'),
      mcq(b, ['الف) شاید', 'ب) کاش', 'ج) واہ', 'د) اور'], 'ب) کاش')]);
    expect(stems.filter((s) => [a, b, 'کون سا جملہ دل کی کوئی آرزو ظاہر کرتا ہے؟'].includes(s))).toHaveLength(1);
  });
  test('RED: an item keyed «اسم آلہ» and the «ہتھیار یا اوزار» item ask one concept: one prints', () => {
    const a = '«قینچی» کس قسم کا اسم ہے؟';
    const { stems } = paper([mcq(a, ['الف) اسم آلہ', 'ب) اسم صوت', 'ج) اسم صفت', 'د) اسم معرفہ'], 'الف) اسم آلہ')]);
    expect(stems.includes(a) && stems.includes('کون سا لفظ کسی ہتھیار یا اوزار کا نام ہے؟')).toBe(false);
  });
  test('RED: a definition stem «… آواز ظاہر کرے …» and the اسم صوت item ask one concept: one prints', () => {
    const a = 'جو لفظ کسی جانور کی آواز ظاہر کرے، ان میں سے وہ لفظ کون سا ہے؟';
    const { stems } = paper([mcq(a, ['الف) میاؤں', 'ب) بلی', 'ج) دودھ', 'د) گھر'], 'الف) میاؤں')]);
    expect(stems.includes(a) && stems.includes('«کوے کی کائیں کائیں» میں «کائیں کائیں» کس قسم کا اسم ہے؟')).toBe(false);
  });
  test('a two-question stem that repeats a concept is never put back after the re-ask', () => {
    const s = 'کون سا جملہ تمنائی ہے؟ اور کیوں؟';
    const { stems, laid } = paper([mcq(s, ['الف) کاش میں اڑ سکتا', 'ب) وہ گیا', 'ج) کیا تم آؤ گے', 'د) بیٹھ جاؤ'], 'الف) کاش میں اڑ سکتا')], true);
    expect(stems).not.toContain(s);
    expect((laid.putBack || []).length).toBe(0);
  });
  test('DOC: a paper with no Section C lays Q1 out once, without the in-Q1 rules (two شکیہ items both print)', () => {
    const exam = read();
    for (const types of Object.values(exam.unseen)) for (const k of Object.keys(types)) types[k] = types[k].filter((q) => q.slot === 'urdu.A.Q1');
    const q1 = items(exam, 'urdu.A.Q1');
    Object.assign(q1[3], mcq('کون سا جملہ شکیہ ہے؟', ['الف) شاید وہ آئے', 'ب) وہ آیا', 'ج) آؤ', 'د) کاش وہ آئے'], 'الف) شاید وہ آئے'));
    Object.assign(q1[5], mcq('شکیہ جملے میں کون سا لفظ آتا ہے؟', ['الف) کاش', 'ب) نہ جانے', 'ج) آؤ', 'د) واہ'], 'ب) نہ جانے'));
    const stems = items(applyLayout(exam, U, FDE, { reasked: false }).examJson, 'urdu.A.Q1').map((q) => q.question);
    expect(stems.filter((s) => /شکیہ/.test(s))).toHaveLength(2);
  });
});

describe('story-name cue', () => {
  test('a stem naming the key and a second option is no cue, for the story rule and the one-word-key rule alike: both stay', () => {
    const a = 'ببلو نے اسلم اور کیک کے بارے میں ڈائری میں کیا لکھا؟';
    const b = 'ببلو نے اپنے دوست کے لیے کیا بنانے کا سوچا؟';
    const { stems } = paper([mcq(a, ['الف) سالگرہ', 'ب) کہانی', 'ج) نظم', 'د) خط'], 'الف) سالگرہ'),
      mcq(b, ['الف) کھیر', 'ب) حلوہ', 'ج) کیک', 'د) اسلم'], 'ج) کیک')]);
    expect(stems.includes(a) && stems.includes(b)).toBe(true);
  });
  test('a story stem that names only the key option holds one of the pair', () => {
    const a = 'ببلو نے کیک بنانے کے لیے کس سے مدد مانگی؟';
    const b = 'ببلو نے اپنے دوست کے لیے کیا بنانے کا سوچا؟';
    const { stems } = paper([mcq(a, ['الف) امی سے', 'ب) ابو سے', 'ج) بہن سے', 'د) دوست سے'], 'الف) امی سے'),
      mcq(b, ['الف) کھیر', 'ب) حلوہ', 'ج) کیک', 'د) بسکٹ'], 'ج) کیک')]);
    expect(stems.includes(a) && stems.includes(b)).toBe(false);
  });
});
