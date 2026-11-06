/**
 * bd-5jmnfj.38.31 — MCQ leaks (A5b) on a G6-12 free paper: the writer is asked for about 30% more
 * MCQs than the plan needs, and the subset kept is the one with the fewest flagged items, chosen
 * greedily, a tie going to the item whose key letter is most common so the letters stay spread.
 */
const P = require('../../bot/shared/services/assessment/free-secondary-pool');
const { items } = require('../../bot/shared/services/assessment/free-secondary-checks');

const mcq = (question, key = 'a') => ({ question, options: ['a) w', 'b) x', 'c) y', 'd) z'], answer: key, marks: 1 });
const srq = (question) => ({ question, answer: 'x', marks: 3 });
const paper = (mcqs, written = [srq('Why?')]) => ({ unseen: { objective: { MCQs: mcqs }, subjective: { 'Short Answers': written } } });
// A stand-in leak check: every MCQ whose stem says LEAK gives away Q-last; LEAK2 is flagged twice.
const issuesOf = (exam) => {
  const all = items(exam);
  const last = all.length;
  const out = [];
  all.forEach((e) => {
    if (/LEAK/.test(e.item.question)) out.push({ n: e.n, check: 'cross-leak', text: 't', avoid: [last] });
    if (/LEAK2/.test(e.item.question)) out.push({ n: e.n, check: 'longest-key', text: 't' });
  });
  return out;
};
const stems = (exam) => exam.unseen.objective.MCQs.map((q) => q.question);

describe('poolTypes', () => {
  it('asks for 30% more MCQs, rounded up, and says how many are extra', () => {
    const types = [{ id: 'mcq', count: 16, category: 'objective' }, { id: 'srq', count: 3, category: 'subjective' }];
    const out = P.poolTypes(types);
    expect(out.types.map((t) => t.count)).toEqual([21, 3]);
    expect(out.extra).toBe(5);
    expect(types[0].count).toBe(16);
  });
  it('adds nothing to a paper without MCQs', () => {
    const types = [{ id: 'srq', count: 3, category: 'subjective' }];
    expect(P.poolTypes(types)).toEqual({ types, extra: 0 });
  });
});

describe('select', () => {
  it('drops the MCQs with the most flags first until the plan count is left', () => {
    const exam = paper([mcq('Q1'), mcq('Q2 LEAK2', 'b'), mcq('Q3', 'c'), mcq('Q4 LEAK', 'd'), mcq('Q5', 'b')]);
    const out = P.select(exam, 3, issuesOf);
    expect(stems(exam)).toEqual(['Q1', 'Q3', 'Q5']);
    expect(out.dropped).toBe(2);
  });
  it('breaks a tie by dropping an MCQ whose key letter is most common', () => {
    const exam = paper([mcq('Q1', 'a'), mcq('Q2', 'b'), mcq('Q3', 'a'), mcq('Q4', 'c')]);
    P.select(exam, 3, issuesOf);
    expect(stems(exam)).toEqual(['Q1', 'Q2', 'Q4']);
  });
  it('leaves a paper with no more MCQs than the plan, and never touches written items or scenario parts', () => {
    const scenario = { passage: 'p', questions: [mcq('S1 LEAK'), mcq('S2 LEAK')] };
    const exam = paper([mcq('Q1 LEAK'), mcq('Q2')], [srq('Why?'), scenario]);
    expect(P.select(exam, 2, issuesOf).dropped).toBe(0);
    P.select(exam, 1, issuesOf);
    expect(stems(exam)).toEqual(['Q2']);
    expect(exam.unseen.subjective['Short Answers'][1].questions).toHaveLength(2);
  });
});

describe('spares and swapLeaks (G7 a6: Q2 "Carbon dioxide" still gave Q5 away after the rewrites)', () => {
  const { paperIssues } = require('../../bot/shared/services/assessment/free-secondary-checks');
  const real = (exam) => paperIssues(exam, { grade: 7 });
  const opt = (k, ...o) => ({ options: o.map((t, i) => `${'abcd'[i]}) ${t}`), answer: `${'abcd'[k]}) ${o[k]}`, marks: 1 });
  const q2 = { question: 'A sealed jar holds a healthy green plant. It sits under bright light for some hours. Which gas amount decreases inside the jar?',
    ...opt(0, 'Carbon dioxide', 'Oxygen', 'Water vapour', 'Nitrogen') };
  const spare = { question: 'Which tissue carries water up the stem?', ...opt(1, 'Phloem', 'Xylem', 'Cortex', 'Epidermis') };
  const q5 = { question: 'Explain why a leaf\'s structure suits it for photosynthesis.', marks: 3,
    answer: 'Leaves are broad, thin and have many stomata, air spaces and chloroplasts, all of which help them absorb light, carbon dioxide and water efficiently for photosynthesis.',
    marking_points: [{ point: 'broad', marks: 1 }, { point: 'stomata', marks: 1 }, { point: 'chloroplasts', marks: 1 }],
    mark_bands: [{ marks: '3', descriptor: 'full' }, { marks: '0', descriptor: 'none' }], accept: 'x', reject: 'y' };
  const g7 = () => paper([{ question: 'Which mineral is needed to make chlorophyll?', ...opt(2, 'Potassium', 'Nitrogen', 'Magnesium', 'Iron') }, q2], [q5]);

  it('select hands back the MCQs it dropped as spares', () => {
    const exam = paper([mcq('Q1'), mcq('Q2 LEAK', 'b'), mcq('Q3', 'c')]);
    const out = P.select(exam, 2, issuesOf);
    expect(out.spares.map((q) => q.question)).toEqual(['Q2 LEAK']);
  });
  it('puts a clean spare in place of an MCQ still leaking, keeping the MCQ count', () => {
    const exam = g7();
    expect(real(exam).map((i) => `${i.n}:${i.check}`)).toEqual(['2:cross-leak']);
    const spares = [spare];
    expect(P.swapLeaks(exam, spares, real)).toBe(1);
    expect(real(exam)).toEqual([]);
    expect(stems(exam)[1]).toBe('Which tissue carries water up the stem?');
    expect(spares).toHaveLength(0);
  });
  it('keeps the paper as it was when no spare lowers the problems', () => {
    const exam = g7();
    expect(P.swapLeaks(exam, [{ ...q2 }], real)).toBe(0);
    expect(stems(exam)[1]).toBe(q2.question);
  });
});
