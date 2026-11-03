/**
 * v29 G5 cross-section asks. Urdu Q1 item 17 «لقب» is a Q3 word-box word, so Q1 hands Q3 its meaning. English Q1(a) 17
 * is the exclamatory sentence «What a lovely garden this is!» and Q3 scores its exclamation mark. English Q2 ii(b)
 * quotes «The fox collected five coins.», the key of Q2 i(d). Each is flagged on the later-answerable slot.
 */
const { crossAskFlags, asks } = require('../../bot/shared/services/assessment/fde-lang-cross-asks');
const urdu = require('./fixtures/fde-v34-g5-urdu-v29.json');
const english = require('./fixtures/fde-v34-g5-english-v29.json');

const paper = (list) => ({
  unseen: { x: { y: list } },
  _layout: { sections: [{ slots: [...new Set(list.map((q) => q.slot))].map((slot) => ({ slot, type: 'y' })) }] },
});

describe('word-box word stated in another stem', () => {
  test('real Urdu paper: Q1 item 17 stem carries the Q3 word لقب', () => {
    const f = crossAskFlags(urdu).filter((x) => x.words.includes('لقب'));
    expect(f).toHaveLength(1);
    expect(f[0].slot).toBe('urdu.A.Q1');
    expect(f[0].with).toEqual(['urdu.C.Q3']);
    expect(f[0].reason).toBe('giveaway');
    expect(f[0].printed).toBe(true);
  });

  test('only the meaning slots count: a Q10 word box is a hint list, not a test of meaning', () => {
    const f = crossAskFlags(paper([
      { slot: 'english.C.Q10', words: ['busy'], question: 'a market' },
      { slot: 'english.A.Q1a', question: 'Which word means busy?', options: ['a) b', 'b) c'], answer: 'a) b' },
    ]));
    expect(f).toEqual([]);
  });

  test('English Q4 word in a Q1(a) stem is flagged', () => {
    const f = crossAskFlags(paper([
      { slot: 'english.C.Q4', words: ['ancient', 'rustle'], question: '', answer: 'x' },
      { slot: 'english.A.Q1a', question: "Which word is the opposite of 'ancient'?", options: ['a) modern', 'b) old'], answer: 'a) modern' },
    ]));
    expect(f).toHaveLength(1);
    expect(f[0].slot).toBe('english.A.Q1a');
    expect(f[0].words).toEqual(['ancient']);
  });
});

describe('an exclamatory MCQ against a punctuation item', () => {
  test('real English paper: Q1(a) 17 is flagged against Q3', () => {
    const f = crossAskFlags(english).filter((x) => x.with.includes('english.C.Q3'));
    expect(f).toHaveLength(1);
    expect(f[0].slot).toBe('english.A.Q1a');
    expect(f[0].words).toContain('exclamatory'); // the slot's one flag also carries «ancient» (Q4 box against Q1(a) 20)
  });

  test('no punctuation item on the paper: nothing to hand over', () => {
    const f = crossAskFlags(paper([
      { slot: 'english.A.Q1a', question: "What type of sentence is 'Wow!'?", options: ['a) exclamatory', 'b) declarative'], answer: 'a) exclamatory' },
    ]));
    expect(f).toEqual([]);
  });

  test('a declarative key is not flagged', () => {
    const f = crossAskFlags(paper([
      { slot: 'english.A.Q1a', question: 'What type is it?', options: ['a) declarative', 'b) exclamatory'], answer: 'a) declarative' },
      { slot: 'english.C.Q3', question: 'x', answer: 'x', scheme: { points: [{ text: 'Exclamation mark placed correctly', marks: 1 }] } },
    ]));
    expect(f).toEqual([]);
  });
});

describe('a quoted sentence that is another question key', () => {
  test('real English paper: Q2 ii(b) quotes the key of Q2 i(d)', () => {
    const f = crossAskFlags(english).filter((x) => x.slot === 'english.B.Q2');
    expect(f).toHaveLength(1);
    expect(f[0].text.join(' ')).toMatch(/How many coins/);
  });

  test('a quoted sentence with fewer than three content words is left alone', () => {
    const f = crossAskFlags(paper([
      { slot: 'english.B.Q2', question: 'Change to plural: "The cat sat."', answer: 'The cats sat.' },
      { slot: 'english.B.Q2', question: 'Who sat?', answer: 'The cat sat.' },
    ]));
    expect(f).toEqual([]);
  });
});

describe('asks()', () => {
  test('reads the items, their sub-questions and the questions inside parts', () => {
    const list = asks(paper([
      { slot: 'a', question: 'one', parts: [{ key: 'k', questions: [{ question: 'two', answer: 'b' }] }], questions: [{ question: 'three' }] },
    ]));
    expect(list.map((x) => x.text)).toEqual(['one', 'three', 'two']);
    expect(list.every((x) => x.slot === 'a')).toBe(true);
  });

  test('null paper is safe', () => {
    expect(crossAskFlags(null)).toEqual([]);
  });
});
