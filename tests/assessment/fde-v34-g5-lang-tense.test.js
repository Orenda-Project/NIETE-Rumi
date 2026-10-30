/**
 * v29 G5 English tested the tense construct five times: Q1(a) 8 and 9, Q1(b) iv and v, Q2 ii(b). Two asks are the cap;
 * every later one is flagged against the first two, so its section is asked again.
 */
const { tenseFlags, tenseAsks, TENSE_CAP } = require('../../bot/shared/services/assessment/fde-tense-count');
const english = require('./fixtures/fde-v34-g5-english-v29.json');

const paper = (list) => ({
  unseen: { x: { y: list } },
  _layout: { sections: [{ slots: [...new Set(list.map((q) => q.slot))].map((slot) => ({ slot, type: 'y' })) }] },
});
const item = (slot, question) => ({ slot, question, answer: 'x' });

describe('the real v29 G5 English paper', () => {
  test('five tense asks are found', () => {
    expect(tenseAsks(english)).toHaveLength(5);
  });

  test('the cap is 2, the later three are flagged on their own slots', () => {
    const f = tenseFlags(english);
    expect(TENSE_CAP).toBe(2);
    expect(f.map((x) => x.slot).sort()).toEqual(['english.A.Q1b', 'english.B.Q2']);
    expect(f.every((x) => x.reason === 'giveaway' && x.printed === true && x.words.includes('tense'))).toBe(true);
  });

  test('each flag names the first two asks as `with`, with the text', () => {
    const f = tenseFlags(english);
    f.forEach((x) => {
      expect(x.with.length).toBeGreaterThan(0);
      expect(x.text).toHaveLength(x.with.length);
    });
    expect(f.flatMap((x) => x.text).join(' ')).toMatch(/simple past tense/);
  });
});

describe('what counts as a tense ask', () => {
  test('past, present, future and perfect wording', () => {
    ['Change into simple past', 'Rewrite the sentence in the future tense', 'Which sentence is in the present perfect tense?',
      'Change the tense of this sentence', 'Rewrite in simple present'].forEach((t) => {
      expect(tenseAsks(paper([item('english.A.Q1b', t)]))).toHaveLength(1);
    });
  });

  test('a sentence that merely contains the word past or present is not an ask', () => {
    ['In the past, the village had a well.', 'He gave a present to Sara.', 'Which word is a noun?'].forEach((t) => {
      expect(tenseAsks(paper([item('english.A.Q1b', t)]))).toEqual([]);
    });
  });
});

describe('the cap', () => {
  test('two asks are fine', () => {
    expect(tenseFlags(paper([item('english.A.Q1b', 'Change into simple past'), item('english.A.Q1b', 'Change into simple present')]))).toEqual([]);
  });

  test('three asks flag the third only', () => {
    const f = tenseFlags(paper([item('english.A.Q1a', 'In the simple past tense?'), item('english.A.Q1b', 'Change into simple past'), item('english.B.Q2', 'Change the tense')]));
    expect(f).toHaveLength(1);
    expect(f[0].slot).toBe('english.B.Q2');
  });

  test('Urdu papers and null are untouched', () => {
    expect(tenseFlags(paper([item('urdu.A.Q1', 'Change into simple past'), item('urdu.A.Q1', 'Change into simple past'), item('urdu.A.Q1', 'Change into simple past')]))).toEqual([]);
    expect(tenseFlags(null)).toEqual([]);
  });
});
