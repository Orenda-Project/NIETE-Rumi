/**
 * v29 G5 Urdu Q1 items 3 and 6: the key is the longest option, by far, and repeats a word of the stem
 * («ہراول دستہ» / «دستہ», «تاب کاری» / «تاب»), so a child picks it without knowing the meaning.
 */
const { keyTellFlags } = require('../../bot/shared/services/assessment/fde-mcq-key-tells');
const urdu = require('./fixtures/fde-v34-g5-urdu-v29.json');
const english = require('./fixtures/fde-v34-g5-english-v29.json');

const paper = (list) => ({
  unseen: { x: { y: list } },
  _layout: { sections: [{ slots: [...new Set(list.map((q) => q.slot))].map((slot) => ({ slot, type: 'y' })) }] },
});
const mcq = (question, options, answer, slot = 'urdu.A.Q1') => ({ slot, question, options, answer: options[0] });

describe('the real v29 G5 Urdu paper', () => {
  const flags = keyTellFlags(urdu);

  test('items 3 and 6 are flagged, nothing else', () => {
    expect(flags).toHaveLength(1);
    expect(flags[0].slot).toBe('urdu.A.Q1');
    expect(flags[0].with).toHaveLength(2);
    expect(flags[0].text.join(' ')).toMatch(/ہراول دستہ/);
    expect(flags[0].text.join(' ')).toMatch(/تاب کاری/);
  });

  test('the idiom key of item 15 and the equal-length key of item 7 are left alone', () => {
    expect(flags[0].text.join(' ')).not.toMatch(/محاورہ|ماہرِ نفسیات/);
  });

  test('flag shape is the giveaway shape', () => {
    expect(flags[0].reason).toBe('giveaway');
    expect(flags[0].printed).toBe(true);
    expect(flags[0].words.length).toBeGreaterThan(0);
  });
});

describe('the rule', () => {
  const opts = (key, others) => [`الف) ${key}`, ...others.map((o, i) => `${'بجد'[i]}) ${o}`)];

  test('a long key repeating a stem word is flagged', () => {
    const q = mcq('«ہراول دستہ» سے کیا مراد ہے؟', opts('فوج کا وہ دستہ جو باقی فوج سے آگے چلے', ['فوج کا پچھلا حصہ', 'فوج کا باورچی', 'فوج کا آرام']), 'الف) x');
    expect(keyTellFlags(paper([q]))).toHaveLength(1);
  });

  test('a long key with no stem word is not flagged', () => {
    const q = mcq('کوئی سوال کیا ہے؟', opts('وہ چیز جو سب کو آگے لے جائے', ['ایک', 'دو', 'تین']), 'الف) x');
    expect(keyTellFlags(paper([q]))).toEqual([]);
  });

  test('a key only one word longer is not flagged', () => {
    const q = mcq('«ہراول دستہ» سے کیا مراد ہے؟', opts('فوج کا دستہ آگے', ['فوج کا پچھلا', 'فوج کا باورچی', 'فوج کا آرام']), 'الف) x');
    expect(keyTellFlags(paper([q]))).toEqual([]);
  });

  test('English: a key with 3 more words repeating a stem word is flagged', () => {
    const q = mcq('What is a predator?', ['a) A predator is an animal that hunts other animals for food', 'b) a plant', 'c) a rock', 'd) a river'], 'a) x', 'english.A.Q1a');
    expect(keyTellFlags(paper([q]))).toHaveLength(1);
  });

  test('English paper has none, null paper is safe', () => {
    expect(keyTellFlags(english)).toEqual([]);
    expect(keyTellFlags(null)).toEqual([]);
  });
});
