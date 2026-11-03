/** A situation part that states what an earlier part asks (bd-5jmnfj.4.58.2). */

const { situationGiveaways } = require('../../bot/shared/services/assessment/fde-situation-check');

const sit = (parts) => ({ unseen: { subjective: { 'Logical Reasoning': [{ slot: 's.B.Q2b', question: 'A torch and three objects.', questions: parts }] } } });

describe('situationGiveaways', () => {
  test('a part comparing «than the glass» gives away the part that keys the glass', () => {
    const f = situationGiveaways(sit([
      { question: 'Which will make the faintest shadow?', answer: 'The drinking glass, because it lets light pass.' },
      { question: 'Why is the cup\'s shadow darker than the glass but lighter than the mug?', answer: 'It is translucent.' },
    ]));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ slot: 's.B.Q2b', reason: 'giveaway', words: ['glass'], printed: true });
  });

  test('parts that do not name the keyed object are clean', () => {
    expect(situationGiveaways(sit([
      { question: 'Which will make the faintest shadow?', answer: 'The drinking glass, because it lets light pass.' },
      { question: 'Why is the cup\'s shadow darker than the mug\'s?', answer: 'It is translucent.' },
    ]))).toEqual([]);
  });

  test('no exam, no flags', () => {
    expect(situationGiveaways(null)).toEqual([]);
  });
});
