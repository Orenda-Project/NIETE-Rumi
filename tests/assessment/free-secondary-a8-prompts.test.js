/**
 * bd-5jmnfj.38.31 (a8) — what the writer and the reviewer are told. The writer gets the level plan, one
 * level per item and part (A6b); a marking point never awards marks for what the stem already prints
 * (grammar items that name the type, A7c). The review reads written items too and answers: is the item
 * really at its tagged level (A4b), does the stem contain its own answer (A5b), does the scheme contradict
 * itself or accept a wrong answer (A7c).
 */
const R = require('../../bot/shared/services/assessment/free-secondary-rules');

describe('rulesBlock: the level plan', () => {
  const plan = 'MCQ 1: Understand\nShort answer 1: Create';

  it('prints the plan and asks for each item at the level it assigns', () => {
    const text = R.rulesBlock(7, null, { light: true, levels: plan });
    expect(text).toContain(plan);
    expect(text).toMatch(/Write each item, and each part, at the level this plan gives it/);
    expect(text).toMatch(/book activity or worked example reproduced counts as Remember/);
  });

  it('keeps the plain 30/30/20/10/10 aim when there is no plan', () => {
    const text = R.rulesBlock(7);
    expect(text).not.toMatch(/at the level this plan gives it/);
    expect(text).toMatch(/about 30% Remember/);
  });

  it('carries the plan through withRules', () => {
    expect(R.withRules('BASE', '', 8, null, { levels: plan })).toContain(plan);
  });
});

describe('rulesBlock: no mark for what the stem prints', () => {
  it('tells the writer a marking point never awards something the stem already states', () => {
    expect(R.rulesBlock(8)).toMatch(/never awards marks for something the stem already prints/);
  });
});

describe('reviewPrompt: written items and the three new questions', () => {
  const mcq = { n: 1, question: 'Which tissue carries water?', options: ['a) xylem', 'b) phloem', 'c) cortex', 'd) pith'], key: 'a) xylem', blooms: 'Remember' };
  const srq = { n: 12, question: 'How can a farmer save water for his crops?', answer: 'Drip irrigation.', blooms: 'Apply',
    marking_points: [{ point: 'names a way', marks: 1 }, { point: 'explains it', marks: 1 }],
    accept: 'drip irrigation; watering more often', reject: 'any answer that uses more water',
    mark_bands: [{ descriptor: 'full: a way and its reason', marks: 2 }, { descriptor: 'partial: a way only', marks: 1 }] };
  const text = R.reviewPrompt([mcq, srq], 7);

  it('lists written items with their answer, marking points, bands, accept and do-not-accept', () => {
    expect(text).toMatch(/Q12: How can a farmer save water/);
    expect(text).toContain('Drip irrigation.');
    expect(text).toContain('names a way');
    expect(text).toContain('watering more often');
    expect(text).toContain('any answer that uses more water');
  });

  it('prints each item\'s tagged level', () => {
    expect(text).toMatch(/Tagged level: Apply/);
  });

  it('asks whether each item or part is really at its tagged level, a reproduced book activity counting as Remember', () => {
    expect(text).toMatch(/level_off/);
    expect(text).toMatch(/book activity or worked example reproduced counts as Remember/);
  });

  it('asks whether the stem contains part of its own answer', () => {
    expect(text).toMatch(/self_answer: does the stem contain part of its own answer/);
  });

  it('asks, for written items, whether accept, do-not-accept and bands contradict each other or accept a wrong answer', () => {
    expect(text).toMatch(/scheme_conflict/);
    expect(text).toMatch(/contradict/);
    expect(text).toMatch(/wrong answer/);
  });

  it('still asks the MCQ questions', () => {
    expect(text).toMatch(/two_correct/);
    expect(text).toMatch(/Q1: Which tissue[\s\S]*Key: a\) xylem/);
  });
});
