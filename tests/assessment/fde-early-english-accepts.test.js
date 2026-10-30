/**
 * v37r6 G2 English (bd-5jmnfj.4.58.9.1): the prompt rule "scheme.accept never lists near" did not hold. The loop-6
 * paper keyed under / behind with accept «near», and Q7 keyed «wet» for dry with accept «damp». Both are pruned in code.
 */
const { earlyEnglishAccepts } = require('../../bot/shared/services/assessment/fde-early-english-accepts');
const { earlyEnglishFixes2 } = require('../../bot/shared/services/assessment/fde-early-english-fixes-2');

const exam = () => ({
  _layout: { sections: [{ id: 'B', slots: [{ slot: 'g2.english.B.Q7', type: 'Opposites' }, { slot: 'g2.english.B.Q10', type: 'Prepositions' }] }] },
  unseen: { objective: {
    Opposites: [
      { slot: 'g2.english.B.Q7', question: 'dry', answer: 'wet', scheme: { accept: ['wet', 'damp'] } },
      { slot: 'g2.english.B.Q7', question: 'loud', answer: 'quiet', scheme: { accept: ['quiet', 'silent'] } },
    ],
    Prepositions: [
      { slot: 'g2.english.B.Q10', question: 'The dog is ____ the table.', answer: 'under', scheme: { accept: ['under', 'near'] } },
      { slot: 'g2.english.B.Q10', question: 'The cat is ____ the door.', answer: 'near', scheme: { accept: ['near', 'next to'] } },
    ],
  } },
});
const run = (ex) => earlyEnglishAccepts({ examJson: ex, notes: [] });

describe('G2 English accept lists hold only true answers', () => {
  test('a position keyed in / on / under / behind never accepts near', () => {
    const { examJson, notes } = run(exam());
    expect(examJson.unseen.objective.Prepositions[0].scheme.accept).toEqual(['under']);
    expect(notes.some((n) => /near/.test(n))).toBe(true);
  });
  test('a position keyed near keeps its accept list', () => {
    const { examJson } = run(exam());
    expect(examJson.unseen.objective.Prepositions[1].scheme.accept).toEqual(['near', 'next to']);
  });
  test('an opposite accept drops a word that is not an opposite (damp for dry) and keeps a true one (silent for loud)', () => {
    const { examJson } = run(exam());
    expect(examJson.unseen.objective.Opposites[0].scheme.accept).toEqual(['wet']);
    expect(examJson.unseen.objective.Opposites[1].scheme.accept).toEqual(['quiet', 'silent']);
  });
  test('a G1 or non-English slot is left alone', () => {
    const ex = exam();
    ex.unseen.objective.Prepositions[0].slot = 'g1.english.B.Q10';
    expect(run(ex).examJson.unseen.objective.Prepositions[0].scheme.accept).toEqual(['under', 'near']);
  });
  test('earlyEnglishFixes2 runs the pruning', () => {
    const { examJson } = earlyEnglishFixes2({ examJson: exam(), notes: [] });
    expect(examJson.unseen.objective.Prepositions[0].scheme.accept).toEqual(['under']);
    expect(examJson.unseen.objective.Opposites[0].scheme.accept).toEqual(['wet']);
  });
});
