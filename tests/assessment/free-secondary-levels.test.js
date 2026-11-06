/**
 * bd-5jmnfj.38.31 (a8) — the thinking-level split of a G6-12 free paper, planned before writing. The a7
 * panel failed both papers on A6b (G7: no Create marks; G8: Apply 42% of marks against 20%), so every item
 * and part is given its level up front so that tagged marks land on 30/30/20/10/10 within 5 points, with
 * at least one Create part on a written item. After writing, a split more than 10 points off, or no
 * Create, sends the items whose tag differs from their assignment to the targeted rewrite.
 */
const Levels = require('../../bot/shared/services/assessment/free-secondary-levels');

const TARGET = { R: 0.3, U: 0.3, A: 0.2, AE: 0.1, C: 0.1 };
const G7 = [{ id: 'mcq', count: 7, category: 'objective' }, { id: 'srq', count: 12, category: 'subjective' }, { id: 'erq', count: 1, category: 'subjective' }];
const G8 = [{ id: 'mcq', count: 7, category: 'objective' }, { id: 'srq', count: 7, category: 'subjective' }, { id: 'grammar', count: 6, category: 'subjective' }];

const within = (split, tol) => Object.keys(TARGET).every((b) => Math.abs(split[b] - TARGET[b]) <= tol);

describe('plan: the level of every item and part before writing', () => {
  it.each([['G7 7/12/1 light', G7], ['G8 7/7/6 light', G8]])('%s lands within 5 points of 30/30/20/10/10', (_, types) => {
    const units = Levels.plan(types, true);
    const split = Levels.splitOf(units);
    expect(within(split, 0.05)).toBe(true);
  });

  it('marks the G7 light shape as the paper prints it: 34 marks, the extended answer in three 1-mark parts', () => {
    const units = Levels.plan(G7, true);
    expect(units.reduce((s, u) => s + u.marks, 0)).toBe(34);
    expect(units.filter((u) => u.type === 'erq').map((u) => [u.part, u.marks])).toEqual([[0, 1], [1, 1], [2, 1]]);
  });

  it('puts at least one Create on a written item, and never on an MCQ', () => {
    [G7, G8].forEach((types) => {
      const units = Levels.plan(types, true);
      expect(units.some((u) => u.level === 'Create' && u.type !== 'mcq')).toBe(true);
      expect(units.filter((u) => u.type === 'mcq').some((u) => u.level === 'Create')).toBe(false);
    });
  });

  it('climbs through an extended answer: its last part is the highest', () => {
    const erq = Levels.plan(G7, true).filter((u) => u.type === 'erq').map((u) => u.level);
    expect(erq[2]).toBe('Create');
    expect(Levels.LEVELS.indexOf(erq[0])).toBeLessThan(Levels.LEVELS.indexOf(erq[2]));
  });

  it('does not put every MCQ at one level', () => {
    const mcq = new Set(Levels.plan(G8, true).filter((u) => u.type === 'mcq').map((u) => u.level));
    expect(mcq.size).toBeGreaterThan(1);
  });

  it('writes the plan for the writer: one level per item, and per part, by type and number', () => {
    const text = Levels.planText(Levels.plan(G7, true));
    expect(text).toMatch(/MCQ 1: (Remember|Understand|Apply|Analyze)/);
    expect(text).toMatch(/Short answer 12: \w+/);
    expect(text).toMatch(/Extended answer 1: \(a\) \w+, \(b\) \w+, \(c\) Create/);
  });

  it('gives MCQs asked for beyond the plan (the pool) a level too', () => {
    const text = Levels.planText(Levels.plan(G7, true), { extraMcqs: 3 });
    expect(text).toMatch(/MCQ 10: \w+/);
  });
});

// A paper as the writer returns it: tags on every item, parts tagged by part_levels.
const mcq = (blooms) => ({ question: 'Which?', options: ['a) w', 'b) x', 'c) y', 'd) z'], answer: 'a) w', marks: 1, blooms });
const srq = (blooms) => ({ question: 'Explain.', answer: 'Because.', marks: 2, blooms });
const erq = (part_levels) => ({ question: 'Stem.\n(a) One.\n(b) Two.\n(c) Three.', answer: '(a) x (b) y (c) z', marks: 3, blooms: part_levels[2], part_levels });
const paperOf = (mcqs, srqs, erqs = []) => ({ unseen: {
  objective: { 'Multiple Choice Questions': mcqs.map(mcq) },
  subjective: { 'Short Answers': srqs.map(srq), 'Long Answers': erqs.map(erq) },
} });

describe('paperSplit and levelIssues: after writing', () => {
  // The G8 a7 paper: Apply 42% of 33 marks, Remember 15%.
  const g8a7 = () => paperOf(['Remember', 'Understand', 'Understand', 'Understand', 'Apply', 'Understand', 'Remember'],
    ['Remember', 'Understand', 'Understand', 'Create', 'Analyze', 'Understand', 'Remember', 'Apply', 'Apply', 'Apply', 'Apply', 'Apply', 'Apply']);

  it('reads the split from the tags, by marks, parts counted on their own', () => {
    const exam = paperOf(['Remember', 'Remember'], ['Apply'], [['Understand', 'Analyze', 'Create']]);
    const split = Levels.paperSplit(exam);
    expect(split.R).toBeCloseTo(2 / 7);
    expect(split.A).toBeCloseTo(2 / 7);
    expect(split.U).toBeCloseTo(1 / 7);
    expect(split.AE).toBeCloseTo(1 / 7);
    expect(split.C).toBeCloseTo(1 / 7);
  });

  it('raises nothing for a paper within 10 points that has a Create', () => {
    const units = Levels.plan(G7, true);
    const tags = (t) => units.filter((u) => u.type === t);
    const exam = paperOf(tags('mcq').map((u) => u.level), tags('srq').map((u) => u.level), [tags('erq').map((u) => u.level)]);
    expect(Levels.levelIssues(exam)).toEqual([]);
  });

  it('sends a paper more than 10 points off to the rewrite, item by item, each told the level to write it at', () => {
    const exam = g8a7();
    const out = Levels.levelIssues(exam);
    expect(out.length).toBeGreaterThan(0);
    out.forEach((i) => {
      expect(i.check).toBe('level-split');
      expect(i.text).toMatch(/write it at (Remember|Understand|Apply|Analyze|Evaluate|Create)/);
    });
    // Moving those items to the levels they are told lands the paper within 5 points.
    out.forEach((i) => {
      const lvl = i.text.match(/write it at (\w+)/)[1];
      const e = Levels.itemsOf(exam)[i.n - 1];
      e.item.blooms = lvl;
    });
    expect(within(Levels.paperSplit(exam), 0.05)).toBe(true);
  });

  it('sends a paper with no Create to the rewrite even when the rest is close: one written item or part goes to Create', () => {
    const exam = paperOf(['Remember', 'Remember', 'Understand', 'Understand', 'Remember'],
      ['Understand', 'Remember', 'Apply', 'Understand'], [['Apply', 'Analyze', 'Evaluate']]);
    const out = Levels.levelIssues(exam);
    const create = out.filter((i) => /write (it|part \([a-c]\)) at Create/.test(i.text));
    expect(create.length).toBeGreaterThan(0);
    create.forEach((i) => expect(Levels.itemsOf(exam)[i.n - 1].isMcq).toBe(false));
  });

  it('names the part of an item in parts', () => {
    const exam = paperOf(['Remember', 'Remember', 'Remember', 'Understand', 'Understand'], ['Understand', 'Remember', 'Apply', 'Apply'],
      [['Apply', 'Analyze', 'Analyze']]);
    const out = Levels.levelIssues(exam);
    expect(out.some((i) => /part \(c\) at Create/.test(i.text))).toBe(true);
  });

  it('raises nothing for a paper that carries no level tag at all: there is no split to read', () => {
    const exam = paperOf([undefined, undefined], [undefined]);
    expect(Levels.levelIssues(exam)).toEqual([]);
  });

  it('asks for no Create on a paper with no written item', () => {
    const exam = paperOf(['Remember', 'Remember', 'Remember', 'Understand', 'Understand', 'Understand', 'Apply', 'Apply', 'Analyze', 'Remember'], []);
    expect(Levels.levelIssues(exam).some((i) => /Create/.test(i.text))).toBe(false);
  });
});
