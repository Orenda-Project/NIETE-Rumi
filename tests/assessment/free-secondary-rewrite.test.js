/**
 * bd-5jmnfj.38.31 — the targeted rewrite of a G6-12 free paper: after the revision, the items that
 * still leak (A5b) or carry a longest-option key or an absolute distractor (A7a/A7b) are sent back on
 * their own, with the items they must not overlap, and merged into the paper by number.
 */
const R = require('../../bot/shared/services/assessment/free-secondary-rewrite');

const OPTS = ['a) Sand', 'b) Water', 'c) Wood', 'd) Salt'];
const mcq = (question, answer = 'd) Salt', options = OPTS) => ({ question, options: options.slice(), answer, marks: 1, lines: 0 });
const srq = (question, answer) => ({ question, answer, marks: 3, lines: 4, marking_points: [{ point: 'p', marks: 3 }] });
const paper = () => ({ unseen: {
  objective: { 'Multiple Choice Questions': [mcq('Which one dissolves?'), mcq('Which one floats?', 'c) Wood')] },
  subjective: { 'Short Answers': [srq('Why does salt vanish in water?', 'Salt dissolves in water.')] },
} });

describe('targets', () => {
  it('keeps leaks, longest keys and absolute options; leaves the rest to the revision', () => {
    const issues = [
      { n: 1, check: 'cross-leak', text: 'x', avoid: [3] }, { n: 2, check: 'longest-key', text: 'y' },
      { n: 2, check: 'absolute-option', text: 'z' }, { n: 3, check: 'marking-points', text: 'w' },
      { n: 0, check: 'lesson-subject', text: 'v' },
    ];
    expect(R.targets(issues).map((i) => `${i.n}:${i.check}`)).toEqual(['1:cross-leak', '2:longest-key', '2:absolute-option']);
  });
});

describe('prompt', () => {
  it('lists each item to rewrite with its problem and the items it must not overlap', () => {
    const text = R.prompt(paper(), [{ n: 1, check: 'cross-leak', text: 'gives away Q3', avoid: [3] }]);
    expect(text).toContain('Q1');
    expect(text).toContain('Which one dissolves?');
    expect(text).toContain('gives away Q3');
    expect(text).toContain('Why does salt vanish in water?');
    expect(text).toContain('Salt dissolves in water.');
    expect(text).toContain('"items"');
    expect(text).not.toContain('Which one floats?');
  });
});

describe('merge', () => {
  it('replaces only the targeted items, keeping marks and lines, without touching the original', () => {
    const exam = paper();
    const before = JSON.stringify(exam);
    const out = R.merge(exam, { items: [
      { n: 1, question: 'Which one is a metal?', options: ['a) Iron', 'b) Wood', 'c) Paper', 'd) Cloth'], answer: 'a) Iron', marks: 9 },
      { n: 2, question: 'Not asked for', options: OPTS, answer: 'a) Sand' },
    ] }, [1]);
    expect(JSON.stringify(exam)).toBe(before);
    expect(out.replaced).toEqual([1]);
    const first = out.exam.unseen.objective['Multiple Choice Questions'][0];
    expect(first).toEqual({ question: 'Which one is a metal?', options: ['a) Iron', 'b) Wood', 'c) Paper', 'd) Cloth'], answer: 'a) Iron', marks: 1, lines: 0 });
    expect(out.exam.unseen.objective['Multiple Choice Questions'][1].question).toBe('Which one floats?');
  });

  it('refuses a reply that changes an item\'s kind or drops its answer', () => {
    const out = R.merge(paper(), { items: [
      { n: 1, question: 'Now a short answer', answer: 'x' },
      { n: 3, question: 'No answer' },
    ] }, [1, 3]);
    expect(out.replaced).toEqual([]);
  });
});
