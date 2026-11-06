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

  it('tells the writer a meaning or quality MCQ takes no opposite of its key as a distractor', () => {
    const text = R.prompt(paper(), [{ n: 1, check: 'longest-key', text: 'long key' }]);
    expect(text).toMatch(/meaning or a quality[^\n]*opposite/);
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

describe('rounds', () => {
  const { paperIssues } = require('../../bot/shared/services/assessment/free-secondary-checks');
  const pts = [{ point: 'p', marks: 3 }];
  const w = (question, answer) => ({ question, answer, marks: 3, lines: 4, marking_points: pts });
  // Each pair is a leak: the second stem prints the first item's answer.
  const leaky = (pairs) => ({ unseen: { subjective: { 'Short Answers': pairs.flatMap(([ans, stem]) => [
    w(`What is the ${ans} test item?`, ans), w(stem, 'It happens in a fictional place.'),
  ]) } } });
  const PAIRS = [['photosynthesis', 'Where does photosynthesis happen?'], ['chlorophyll', 'What colour is chlorophyll?'],
    ['respiration', 'When does respiration happen?']];
  // A fake writer that fixes only the first item it is asked about in each round.
  const oneAtATime = () => jest.fn(async (text) => {
    const n = Number(/Q(\d+) \(/.exec(text)[1]);
    return { items: [{ n, question: `A fresh fictional question number ${n}?`, answer: 'It happens in a fictional place.' }] };
  });

  it('runs a second round while flags remain and the count keeps dropping', async () => {
    const exam = leaky(PAIRS.slice(0, 2));
    const issues = paperIssues(exam);
    expect(issues.map((i) => `${i.n}:${i.check}`)).toEqual(['2:cross-leak', '4:cross-leak']);
    const ask = oneAtATime();
    const out = await R.rounds({ examJson: exam, issues, ask, check: paperIssues });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(out.rewritten).toEqual([2, 4]);
    expect(out.issues).toEqual([]);
  });

  it('stops after two rounds', async () => {
    const exam = leaky(PAIRS);
    const ask = oneAtATime();
    const out = await R.rounds({ examJson: exam, issues: paperIssues(exam), ask, check: paperIssues });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(out.issues.map((i) => i.n)).toEqual([6]);
  });

  it('stops, keeping the last better paper, when a round does not lower the count', async () => {
    const exam = leaky(PAIRS.slice(0, 1));
    const ask = jest.fn(async () => ({ items: [{ n: 2, question: 'Why is photosynthesis slow here?', answer: 'x y' }] }));
    const out = await R.rounds({ examJson: exam, issues: paperIssues(exam), ask, check: paperIssues });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(out.rewritten).toEqual([]);
    expect(out.exam).toBe(exam);
  });

  it('makes no call when nothing is left to target, and stops on a failed call', async () => {
    const ask = jest.fn();
    const clean = await R.rounds({ examJson: paper(), issues: [{ n: 3, check: 'marking-points', text: 'x' }], ask, check: paperIssues });
    expect(ask).not.toHaveBeenCalled();
    expect(clean.issues).toHaveLength(1);
    const exam = leaky(PAIRS.slice(0, 1));
    const errors = [];
    const out = await R.rounds({ examJson: exam, issues: paperIssues(exam), ask: async () => { throw new Error('down'); },
      check: paperIssues, onError: (e) => errors.push(e.message) });
    expect(errors).toEqual(['down']);
    expect(out.rewritten).toEqual([]);
  });
});
