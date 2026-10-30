/**
 * G5 Science Q1 (a) MCQs that state a Section B or C mark point (bd-5jmnfj.4.58.4). v28 G5 Science: Q1 (a) ii asked
 * "What do we call materials that let some light pass through but scatter it?" (key: Translucent) while Q3 (a) 3 and
 * Q2 (b) iii c key «lets some light pass and scatters it»; Q1 (a) viii's key «teaches the body's defences to recognise
 * and fight the germs» is Q3 (a) 5's key; Q1 (a) xix's «washing hands with soap and water» is Q3 (b) 1's K2 point; Q1 (a)
 * xi's pulse key is what Q3 (b) 2 asks; Q1 (a) xx's copper coin is Q3 (a) 7's example.
 * The check flags the MCQ's slot so the Q1 section is asked again. Fixtures: the real v28 G5 papers, trimmed.
 */

const { mcqGiveaways } = require('../../bot/shared/services/assessment/fde-mcq-giveaway');
const { answerRepeats, giveawayNote } = require('../../bot/shared/services/assessment/fde-answer-repeats');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const science = require('./fixtures/fde-v29-g5-science.json');
const maths = require('./fixtures/fde-v29-g5-maths.json');
const english = require('./fixtures/fde-v29-g5-english.json');
const urdu = require('./fixtures/fde-v29-g5-urdu.json');

const items = (paper) => Object.values(paper.unseen).flatMap((t) => Object.values(t)).flat();
const mcq = (paper, text) => items(paper).find((q) => q.options && q.question.includes(text));
// The paper with only the named MCQs kept among the MCQs; every other item stays.
const withMcqs = (paper, texts) => {
  const out = JSON.parse(JSON.stringify(paper));
  Object.values(out.unseen).forEach((t) => Object.keys(t).forEach((k) => { t[k] = t[k].filter((q) => !q.options || texts.some((x) => q.question.includes(x))); }));
  return out;
};

const FLAGGED = [
  ['Q1 (a) ii translucent', 'What do we call materials that let some light pass'],
  ['Q1 (a) v decomposers', 'role of decomposers in a food web'],
  ['Q1 (a) viii vaccine', 'How does a vaccine protect us'],
  ['Q1 (a) xi pulse', 'After a fast race, Rani finds that her pulse'],
  ['Q1 (a) xix handwashing', 'A viral outbreak is spreading in a school'],
  ['Q1 (a) xx copper coin', 'wants electric current to flow across'],
  ['Q1 (a) xv shadow cup', 'wants the darkest shadow'],
];
const CLEAN = [
  ['Q1 (a) i nervous system', 'control centre of the nervous system'],
  ['Q1 (a) iii decibels', 'In which unit is the intensity of sound measured'],
  ['Q1 (a) iv spreading disease', 'Which of these diseases can spread'],
  ['Q1 (a) x magnet attracts', 'attracted by a magnet'],
  ['Q1 (a) xiii river waste', 'pours its waste into a river'],
  ['Q1 (a) xvi steel glass', 'strikes a steel glass'],
  ['Q1 (a) xviii compass', 'hiker\'s compass'],
];

describe('G5 Science MCQs that state a Section B or C mark point are flagged on the Q1 (a) slot', () => {
  test.each(FLAGGED)('%s', (_n, text) => {
    const f = mcqGiveaways(science).filter((x) => mcq(science, text).slot === x.slot);
    expect(f.length).toBe(1);
    expect(f[0]).toMatchObject({ slot: 'science.A.Q1a', reason: 'giveaway', printed: true });
    expect(f[0].with.length).toBeGreaterThan(0);
    expect(f[0].with.every((s) => s !== 'science.A.Q1a')).toBe(true);
  });

  test.each(FLAGGED)('%s is flagged when it is the only MCQ on the paper', (_n, text) => {
    expect(mcqGiveaways(withMcqs(science, [text])).length).toBe(1);
  });

  test.each(CLEAN)('%s alone is not flagged', (_n, text) => {
    expect(mcqGiveaways(withMcqs(science, [text]))).toEqual([]);
  });

  test('the flag names the item that holds the point, in words a re-ask can use', () => {
    const f = mcqGiveaways(withMcqs(science, ['How does a vaccine protect us']))[0];
    expect(f.with).toContain('science.C.Q3a');
    expect(f.text.join(' ')).toMatch(/vaccine/i);
    expect(giveawayNote([f])).toMatch(/science\.C\.Q3a/);
  });

  test('it reaches the re-ask path through answerRepeats', () => {
    const p = withMcqs(science, ['What do we call materials that let some light pass']);
    expect(answerRepeats(p).map((x) => x.slot)).toContain('science.A.Q1a');
  });
});

describe('the other Grade 5 papers are not hit by false MCQ flags', () => {
  test('English MCQs flag nothing', () => { expect(mcqGiveaways(english)).toEqual([]); });
  test('Urdu MCQs flag nothing', () => { expect(mcqGiveaways(urdu)).toEqual([]); });
  test('Maths MCQs flag nothing', () => { expect(mcqGiveaways(maths)).toEqual([]); });
  test('a paper with no layout or no items flags nothing', () => {
    expect(mcqGiveaways(null)).toEqual([]);
    expect(mcqGiveaways({})).toEqual([]);
  });
});

describe('G5 Science Q1 (a) prompt rule', () => {
  test('no MCQ tests a concept a Section B or C question asks, and no option states a fact a later question explains', () => {
    const rule = Patterns.subjectOf('fde_g5_2027', 'science').sections.flatMap((s) => s.slots).find((s) => s.slot === 'science.A.Q1a').prompt_rule;
    expect(rule).toMatch(/No MCQ tests a concept that a Section B or Section C question of this paper asks/);
    expect(rule).toMatch(/no stem or option states a fact that a later question asks the child to explain/);
  });
});
