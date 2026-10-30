/**
 * G5 Science: a Section A MCQ whose keyed option is a key point of a B/C item (v37r4 panel, bd-5jmnfj.4.58).
 * The paper's own items are the fixtures (fde-v37r4-g5-science.json).
 */
const { keyedOptionGivers } = require('../../bot/shared/services/assessment/fde-science-option-keys');
const { scienceGivers, scienceGiverFlags } = require('../../bot/shared/services/assessment/fde-science-giveaway-drop');
const paper = require('./fixtures/fde-v37r4-g5-science.json');

const pts = (...t) => ({ points: t.map((text) => ({ text, marks: 1, kind: 'K' })), accept: [] });
const mcq = (question, options, answer) => ({ slot: 'science.A.Q1a', question, options, answer, marks: 1 });
const c = (question, scheme) => ({ slot: 'science.C.Q3a', question, answer: 'x', marks: 5, scheme });
const build = (a, cs) => ({ unseen: { objective: { MCQs: a }, subjective: { 'Brief Answers': cs } } });

describe('the paper the panel held', () => {
  const found = keyedOptionGivers(paper);
  const of = (re) => found.find((g) => re.test(g.question));

  it('finds the MCQs whose keyed option is a key point', () => {
    expect(of(/breathes faster/)).toMatchObject({ slot: 'science.A.Q1a', with: ['science.C.Q3a'] });
    expect(of(/frog catches/)).toBeTruthy();
    expect(of(/pulled towards a/)).toBeTruthy();
    expect(of(/guitar string/)).toBeTruthy();
  });

  it('leaves the option that only shares a word inside a long sentence', () => {
    expect(of(/Sound travels fastest/)).toBeUndefined();
  });

  it('is part of scienceGivers and its flags, once per MCQ', () => {
    const all = scienceGivers(paper);
    expect(all.filter((g) => /breathes faster/.test(g.question))).toHaveLength(1);
    expect(all.filter((g) => /frog catches/.test(g.question))).toHaveLength(1);
    expect(scienceGiverFlags(paper).some((f) => /frog catches/.test(f.text.join(' ')) || f.slot === 'science.A.Q1a')).toBe(true);
  });
});

describe('small papers', () => {
  const key = c('Why do plants need sunlight?', pts('Plants make food by photosynthesis'));

  it('flags a one-word option a short key point says', () => {
    const m = mcq('Which process makes food in a leaf?', ['a) photosynthesis', 'b) digestion', 'c) erosion', 'd) melting'], 'a) photosynthesis');
    const out = keyedOptionGivers(build([m], [c('How do plants get energy?', pts('Photosynthesis'))]));
    expect(out).toHaveLength(1);
    expect(out[0].words).toContain('photosynthesi');
  });

  it('ignores an option word the MCQ stem already prints', () => {
    const m = mcq('Which kind of animal is a hawk?', ['a) predator', 'b) herbivore', 'c) producer', 'd) decomposer'], 'a) predator');
    expect(keyedOptionGivers(build([m], [c('What is a predator?', pts('A predator hunts')) ]))).toHaveLength(1);
    const m2 = mcq('Which predator is a hawk?', ['a) predator', 'b) x', 'c) y', 'd) z'], 'a) predator');
    expect(keyedOptionGivers(build([m2], [c('What is a predator?', pts('A predator hunts'))]))).toEqual([]);
  });

  it('ignores a long point (a sentence is an idea, not the option)', () => {
    const m = mcq('Which gas is released?', ['a) hydrogen', 'b) x', 'c) y', 'd) z'], 'a) hydrogen');
    const long = c('Explain the test.', pts('The gas pops with a flame and the test shows hydrogen is released'));
    expect(keyedOptionGivers(build([m], [long]))).toEqual([]);
  });

  it('finds none on a clean paper and never changes the input', () => {
    const exam = build([mcq('Which part makes seeds?', ['a) pistil', 'b) root', 'c) leaf', 'd) bud'], 'a) pistil')], [key]);
    const copy = JSON.parse(JSON.stringify(exam));
    expect(keyedOptionGivers(exam)).toEqual([]);
    expect(exam).toEqual(copy);
    expect(keyedOptionGivers(null)).toEqual([]);
  });
});
