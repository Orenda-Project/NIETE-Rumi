/**
 * bd-5jmnfj.38.31 — the distractor review of a G6-12 free paper (A7b, and the longest key of A7a):
 * one small model call rates each distractor 1-3 for a G6-8 student who holds a common misconception
 * and flags a key that is the longest option. A distractor rated 1 sends its item to the targeted
 * rewrite. The model here is a fake.
 */
const Review = require('../../bot/shared/services/assessment/free-secondary-review');
const { reviewPrompt } = require('../../bot/shared/services/assessment/free-secondary-rules');

const mcq = (question, answer, options) => ({ question, options, answer, marks: 1, lines: 0 });
const paper = () => ({ unseen: {
  objective: { 'Multiple Choice Questions': [
    mcq('Which gas do plants take in?', 'b) Carbon dioxide', ['a) Oxygen', 'b) Carbon dioxide', 'c) Nitrogen', 'd) Chocolate']),
    mcq('What is the unit of force?', 'a) Newton', ['a) Newton', 'b) Joule', 'c) Watt', 'd) Pascal']),
  ] },
  subjective: { 'Short Answers': [{ question: 'Why do leaves look green?', answer: 'Chlorophyll.', marks: 2 }] },
} });

describe('reviewPrompt (rules)', () => {
  it('asks for a 1-3 plausibility rating per distractor for a student with a misconception, and a longest-key flag', () => {
    const text = reviewPrompt(Review.mcqsOf(paper()), 7);
    expect(text).toContain('Grade 7');
    expect(text).toMatch(/misconception/);
    expect(text).toMatch(/1.*3/);
    expect(text).toContain('longest_key');
    expect(text).toContain('Q1: Which gas do plants take in?');
    expect(text).toContain('d) Chocolate');
    expect(text).not.toContain('Why do leaves look green?');
  });
});

describe('mcqsOf', () => {
  it('lists the MCQs by their paper number with the key letter', () => {
    expect(Review.mcqsOf(paper()).map((m) => `${m.n}:${m.key}`)).toEqual(['1:b', '2:a']);
  });
});

describe('issuesFrom', () => {
  const reply = { items: [
    { n: 1, distractors: [{ option: 'a', rating: 3 }, { option: 'c', rating: 2 }, { option: 'd', rating: 1, why: 'not a gas' }], longest_key: true },
    { n: 2, distractors: [{ option: 'b', rating: 2 }, { option: 'c', rating: 3 }, { option: 'd', rating: 2 }], longest_key: false },
    { n: 3, distractors: [{ option: 'a', rating: 1 }], longest_key: true },
  ] };

  it('sends an item with a distractor rated 1 to the rewrite as weak-distractor, naming the option', () => {
    const out = Review.issuesFrom(reply, paper(), []);
    const weak = out.filter((i) => i.check === 'weak-distractor');
    expect(weak.map((i) => i.n)).toEqual([1]);
    expect(weak[0].text).toContain('d)');
    expect(weak[0].text).toContain('not a gas');
  });

  it('flags a longest key the model sees, unless the length check already did', () => {
    expect(Review.issuesFrom(reply, paper(), []).filter((i) => i.check === 'longest-key').map((i) => i.n)).toEqual([1]);
    expect(Review.issuesFrom(reply, paper(), [{ n: 1, check: 'longest-key', text: 'x' }])
      .filter((i) => i.check === 'longest-key')).toEqual([]);
  });

  it('ignores a rating of the key itself, a written item, and a reply it cannot read', () => {
    const keyRated = { items: [{ n: 2, distractors: [{ option: 'a', rating: 1 }] }] };
    expect(Review.issuesFrom(keyRated, paper(), [])).toEqual([]);
    expect(Review.issuesFrom({ items: [{ n: 3, distractors: [{ option: 'a', rating: 1 }] }] }, paper(), [])).toEqual([]);
    expect(Review.issuesFrom(null, paper(), [])).toEqual([]);
    expect(Review.issuesFrom({ items: 'x' }, paper(), [])).toEqual([]);
  });
});

describe('stillOpen', () => {
  it('keeps a review issue only while its item is unchanged', () => {
    const exam = paper();
    const issues = Review.issuesFrom({ items: [{ n: 1, distractors: [{ option: 'd', rating: 1 }] }] }, exam, []);
    expect(Review.stillOpen(exam, issues)).toHaveLength(1);
    exam.unseen.objective['Multiple Choice Questions'][0].options[3] = 'd) Hydrogen';
    expect(Review.stillOpen(exam, issues)).toEqual([]);
  });
});

describe('review (fake model)', () => {
  it('makes one call with the review prompt and returns the issues', async () => {
    const ask = jest.fn().mockResolvedValue({ items: [{ n: 1, distractors: [{ option: 'd', rating: 1 }] }] });
    const out = await Review.review({ examJson: paper(), grade: 7, ask, existing: [] });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toContain('Which gas do plants take in?');
    expect(out.map((i) => `${i.n}:${i.check}`)).toEqual(['1:weak-distractor']);
  });

  it('makes no call for a paper with no MCQs, and returns nothing when the call fails', async () => {
    const ask = jest.fn().mockRejectedValue(new Error('down'));
    const none = { unseen: { subjective: { S: [{ question: 'q', answer: 'a' }] } } };
    expect(await Review.review({ examJson: none, grade: 7, ask })).toEqual([]);
    expect(ask).not.toHaveBeenCalled();
    const onError = jest.fn();
    expect(await Review.review({ examJson: paper(), grade: 7, ask, onError })).toEqual([]);
    expect(onError).toHaveBeenCalled();
  });
});
