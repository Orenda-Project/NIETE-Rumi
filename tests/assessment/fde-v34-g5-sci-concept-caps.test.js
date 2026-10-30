/**
 * One construct tested too often on a G5 Science paper (bd-5jmnfj.4.58 round 4). v29 asked physical versus chemical change
 * six times, transparent / translucent / opaque five times, labelled the respiratory system twice and paid the
 * greenhouse point twice. fde-concept-count counted a sub-question as part of its item, matched stems and keyed options
 * only, and allowed two asks of every concept.
 */
const { conceptCaps } = require('../../bot/shared/services/assessment/fde-concept-caps');
const { paperGiveaways } = require('../../bot/shared/services/assessment/fde-g5-paper-giveaways');
const exam = require('./fixtures/fde-v34-g5-science-v29.json');

const flags = conceptCaps(exam);
const of = (name) => flags.filter((f) => f.words.includes(name));

describe('the real v29 G5 Science paper', () => {
  test('physical and chemical change: asks past the third are flagged, naming the earlier slots', () => {
    const f = of('physical and chemical change');
    expect(f.length).toBeGreaterThan(0);
    expect(f.some((x) => x.slot === 'science.C.Q3a')).toBe(true);
    f.forEach((x) => expect(x.with.length).toBeGreaterThan(0));
  });

  test('transparent, translucent and opaque: counts each sub-question of Q2 (b) (iii) and its keyed answer', () => {
    expect(of('transparent, translucent and opaque').map((x) => x.slot)).toEqual(expect.arrayContaining(['science.C.Q3a']));
  });

  test('labelling the respiratory system is asked once', () => {
    const f = of('labelling the respiratory system');
    expect(f.map((x) => x.slot)).toEqual(['science.B.Q2a']);
  });

  test('the greenhouse point is keyed by one item only', () => {
    const f = of('the greenhouse trap point');
    expect(f.map((x) => x.slot)).toEqual(['science.C.Q3b']);
  });

  test('flags carry the shape fde-answer-repeats reads', () => {
    flags.forEach((x) => expect(x).toEqual({ slot: expect.any(String), reason: 'giveaway', words: expect.any(Array), with: expect.any(Array), text: expect.any(Array), printed: true }));
  });

  test('paperGiveaways includes them', () => {
    expect(paperGiveaways(exam).some((x) => x.words.includes('the greenhouse trap point'))).toBe(true);
  });
});

describe('small papers', () => {
  const mcq = (slot, question, key) => ({ slot, question, options: [`a) ${key}`, 'b) Rain', 'c) Wind', 'd) Snow'], answer: `a) ${key}` });
  const paper = (list) => ({ unseen: { x: { y: list } }, _layout: { sections: [{ slots: [...new Set(list.map((q) => q.slot))].map((slot) => ({ slot, type: 'y' })) }] } });

  test('three asks of one concept are fine', () => {
    const p = paper([mcq('science.A.Q1a', 'Which is a chemical change?', 'Rusting'), mcq('science.A.Q1a', 'Melting ice is a physical change. True?', 'Yes'),
      { slot: 'science.C.Q3a', question: 'Why is burning a chemical change?', answer: 'x' }]);
    expect(of.call(null, 'x')).toEqual([]);
    expect(conceptCaps(p)).toEqual([]);
  });

  test('a fourth ask is flagged, a sub-question counts as an ask of its own', () => {
    const sub = (question, answer) => ({ question, answer });
    const p = paper([mcq('science.A.Q1a', 'Which is a chemical change?', 'Rusting'),
      { slot: 'science.B.Q2b', question: 'A nail rusts.', questions: [sub('Why is rusting a chemical change?', 'new substance'), sub('Is melting a physical change?', 'yes')] },
      { slot: 'science.C.Q3a', question: 'Explain a physical change.', answer: 'x' }]);
    expect(conceptCaps(p).map((x) => x.slot)).toEqual(['science.C.Q3a']);
  });

  test('not science, no paper', () => {
    expect(conceptCaps(null)).toEqual([]);
    expect(conceptCaps({ unseen: { x: { y: [{ slot: 'maths.A.Q1a', question: 'chemical change', answer: 'x' }] } } })).toEqual([]);
  });
});
