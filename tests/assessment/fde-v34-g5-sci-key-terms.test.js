/**
 * v29 G5 Science: Section A stems and options printed what Section B and C key or mark (bd-5jmnfj.4.58 round 4).
 * fde-mcq-giveaway needs 4 shared words (or 3 with 2 from the key) and never read a one-word line, so these
 * shipped: Q1 (a) x «coal and oil» (Q3 (a) 6's fuels), vii «grass, rabbit, fox» (Q2 (a) ii's chain), viii «producer»
 * (Q2 (a) ii's label), iv «fungus» (Q3 (a) 4 K1), xviii «Steel paper clip» (Q3 (a) 10), ii «blood vessels, heart»
 * (Q3 (a) 1). The check reads each key or mark line on its own and flags the item that prints its words.
 */

const { keyTermGiveaways } = require('../../bot/shared/services/assessment/fde-key-term-giveaway');
const science = require('./fixtures/fde-v34-g5-science-v29.json');

const items = [];
Object.values(science.unseen).forEach((t) => Object.values(t).forEach((l) => items.push(...l)));
const mcqs = items.filter((q) => q.slot === 'science.A.Q1a');
const asked = (frag) => mcqs.find((q) => q.question.includes(frag)).question.slice(0, 70);
const flagsFor = (frag) => keyTermGiveaways(science).filter((f) => f.text.some((t) => t.includes(`«${asked(frag)}`)));

test.each([
  ['Burning coal and oil', ['coal', 'oil'], 'science.C.Q3a'],
  ['In the chain grass, rabbit, fox', ['grass', 'rabbit', 'fox'], 'science.B.Q2a'],
  ['Which of these is a producer?', ['producer'], 'science.B.Q2a'],
  ['Which disease is caused by a fungus?', ['fungus'], 'science.C.Q3a'],
  ['Which material would NOT complete a circuit', ['steel', 'paper', 'clip'], 'science.C.Q3a'],
  ['Which blood vessels take blood out', ['blood', 'vessel', 'heart'], 'science.C.Q3a'],
])('%s is flagged against the key it prints', (frag, words, other) => {
  const f = flagsFor(frag);
  expect(f.length).toBeGreaterThan(0);
  expect(f[0].slot).toBe('science.A.Q1a');
  expect(f.flatMap((x) => x.with)).toContain(other);
  words.forEach((w) => expect(f.flatMap((x) => x.words).join(' ')).toContain(w));
});

test('flags carry the shape fde-answer-repeats reads', () => {
  keyTermGiveaways(science).forEach((f) => {
    expect(f).toMatchObject({ reason: 'giveaway', printed: true });
    expect(f.with.length).toBe(f.text.length);
    expect(f.words.length).toBeGreaterThan(0);
  });
});

test('a stem that prints only words its own stem already gave is not flagged', () => {
  const p = {
    unseen: { x: { y: [
      { slot: 'science.A.Q1a', question: 'What is the Moon?', options: ['a) A star', 'b) A satellite', 'c) A planet', 'd) A comet'], answer: 'b) A satellite' },
      { slot: 'science.C.Q3a', question: 'Explain why the Moon is a satellite.', answer: 'The Moon goes around the Earth, so it is a satellite.', scheme: { points: [{ text: 'Goes around the Earth', marks: 2 }] } },
    ] } },
    _layout: { sections: [{ slots: [{ slot: 'science.A.Q1a' }, { slot: 'science.C.Q3a' }] }] },
  };
  expect(keyTermGiveaways(p)).toEqual([]);
});

test('no paper, and a paper that is not science', () => {
  expect(keyTermGiveaways(null)).toEqual([]);
  expect(keyTermGiveaways({ unseen: { x: { y: [{ slot: 'english.A.Q1', question: 'Name three things', answer: 'cat dog pig' }] } } })).toEqual([]);
});
