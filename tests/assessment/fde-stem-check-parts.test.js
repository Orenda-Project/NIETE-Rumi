/**
 * bd-5jmnfj.29: the stem check did not see an unseen passage's sub-questions. English Q2 prints its
 * passage, then groups i. (questions) and ii. (do as directed), each sub-question lettered (a) (b)…;
 * those live in the item's `parts` groups, which the check never listed, so a sub-question about
 * something the passage does not contain went to print unchecked.
 *
 * Pure: no model, no network.
 */

const SC = require('../../bot/shared/services/assessment/fde-stem-check');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const G5 = Patterns.get('fde_g5_2027').subjects;

const sub = (question, answer) => ({ question, answer, scheme: { points: [{ kind: 'A', text: answer, marks: 1 }], accept: [] } });

const english = () => ({
  unseen: {
    subjective: {
      'Comprehension Passage': [{
        slot: 'english.B.Q2',
        main_question: 'Read the passage and answer the questions',
        passage: 'Samir sold fresh mangoes at the market. After the storm the river rose.',
        parts: [
          { key: 'questions', questions: [sub('What did Samir sell at the market?', 'Fresh mangoes.'), sub('What did Samir buy for his sister?', 'A red kite.')] },
          { key: 'do_as_directed', questions: [sub('Write True or False: The storm came in the evening.', 'False.')] },
          { key: 'pick', pick: { Nouns: ['Samir', 'market'], Verbs: ['sold', 'rose'] }, questions: [sub('Write five nouns from the passage.', 'Samir, market')] },
        ],
      }],
    },
  },
  _layout: {},
});

describe('the stem check sees a passage\'s sub-questions (bd-5jmnfj.29)', () => {
  const { prompt, targets } = SC.buildStemCheckPrompt(english(), G5.english);

  it('lists each printed sub-question under its group, lettered as the paper prints them', () => {
    expect(prompt).toContain('Q2.1.i.a What did Samir sell at the market?');
    expect(prompt).toContain('Q2.1.i.b What did Samir buy for his sister?');
    expect(prompt).toContain('Q2.1.ii.a Write True or False: The storm came in the evening.');
  });

  it('lists them after the passage, which prints above them', () => {
    expect(prompt.indexOf('passage: Samir sold')).toBeLessThan(prompt.indexOf('Q2.1.i.a'));
  });

  it('leaves out a group that prints blanks, not questions (pick)', () => {
    expect(prompt).not.toContain('Write five nouns from the passage.');
    expect([...targets.keys()].some((k) => k.startsWith('Q2.1.iii'))).toBe(false);
  });

  it('says how a group\'s sub-question is labelled', () => {
    expect(prompt).toMatch(/Q2\.1\.ii\.a is sub-question \(a\) of group ii\./);
  });

  it('a flag on a sub-question rewords that sub-question in the paper', () => {
    const flags = SC.parseStemFlags({ flags: [{ label: 'Q2.1.i.b', problem: 'The passage has no kite.', question: 'What happened to the river after the storm?', answer: 'It rose.' }] }, targets);
    const { examJson, record } = SC.applyStemFixes(english(), G5.english, flags);
    const q = examJson.unseen.subjective['Comprehension Passage'][0].parts[0].questions[1];
    expect(q.question).toBe('What happened to the river after the storm?');
    expect(q.answer).toBe('It rose.');
    expect(record[0]).toMatchObject({ label: 'Q2.1.i.b', outcome: 'reworded' });
  });
});
