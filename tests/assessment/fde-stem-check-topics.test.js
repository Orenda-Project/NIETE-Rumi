/**
 * bd-5jmnfj.28: the stem check did not see an item's topics. English Q8 prints its three paragraph
 * topics under the question as (a) (b) (c); the check read «Write a paragraph on any one topic.»
 * with no topics beside it, flagged it as missing them and reworded it to list them, so the
 * staging paper (20 Oct, request 1bcd5872) printed the topics twice.
 *
 * Pure: no model, no network.
 */

const SC = require('../../bot/shared/services/assessment/fde-stem-check');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const G5 = Patterns.get('fde_g5_2027').subjects;
const TOPICS = ['Recycling', 'My Super Hero', 'A Cultural Festival'];

const english = () => ({
  unseen: {
    subjective: {
      'Paragraph Writing': [{
        slot: 'english.C.Q8',
        question: 'Write a paragraph on any one topic.',
        topics: TOPICS,
        answer: 'A topic sentence, four to six supporting sentences, a concluding sentence.',
      }],
    },
  },
  _layout: {},
});

describe('the stem check sees the topics a question prints (bd-5jmnfj.28)', () => {
  const { prompt } = SC.buildStemCheckPrompt(english(), G5.english);

  it('shows Q8\'s topics under it, lettered as the paper prints them', () => {
    expect(prompt).toMatch(/Q8\.1 Write a paragraph on any one topic\.\n\s+topics: \(a\) Recycling \| \(b\) My Super Hero \| \(c\) A Cultural Festival/);
  });

  it('says the topics print under their question', () => {
    expect(prompt).toMatch(/"topics:" are printed under their question as \(a\), \(b\), \(c\)/);
  });

  it('leaves out topics on a slot that does not print them', () => {
    const paper = english();
    paper.unseen.subjective['Paragraph Writing'][0].slot = 'english.C.Q7';
    const { prompt: p } = SC.buildStemCheckPrompt(paper, G5.english);
    expect(p).toContain('Q7.1 Write a paragraph on any one topic.');
    expect(p).not.toMatch(/topics: \(a\)/);
  });
});
