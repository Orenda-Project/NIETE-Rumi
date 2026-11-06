/**
 * bd-5jmnfj.38.31 (a8) — the review reads written items too. The a7 G7 panel found: Q12's accept line
 * allows "watering more often" for reducing water loss, Q17's and Q18's partial bands award what their
 * do-not-accept lines refuse (A7c); Q8's stem names the shoot system its answer needs (A5b); 7 of 22
 * level tags off (A4b). Each yes from the reviewer is an issue for the targeted rewrite; a level that is
 * off is rewritten to the tagged level, never retagged. The model here is a fake.
 */
const Review = require('../../bot/shared/services/assessment/free-secondary-review');

const written = (question, extra) => ({ question, answer: 'x', marks: 2, blooms: 'Apply', accept: 'a', reject: 'r',
  mark_bands: [{ descriptor: 'full', marks: 2 }, { descriptor: 'partial', marks: 1 }, { descriptor: 'none', marks: 0 }], ...extra });

// The a7 G7 items the panel flagged, as fixtures (the paper's Q6, Q8, Q12, Q17, Q18 at positions 1-5).
const paper = () => ({ unseen: {
  objective: { 'Multiple Choice Questions': [{ question: 'Which force pulls water upward through the xylem in a plant?',
    options: ['a) Transpiration pull', 'b) Phloem pull', 'c) Respiration pressure', 'd) Diffusion pressure'], answer: 'a) Transpiration pull', marks: 1, blooms: 'Understand' }] },
  subjective: { 'Short Answers': [
    written('Name the two systems found in plants. List the main parts of the shoot system.', { blooms: 'Remember' }),
    written('A potted plant wilts every afternoon, though watered each morning. Suggest one reason for this. Suggest one way to reduce water loss.',
      { accept: 'Accept any sensible method such as shading, misting, reducing wind exposure, or watering more often.' }),
    written('A thick, waxy leaf is compared with a thin leaf having many stomata. Which leaf is better adapted for photosynthesis? Explain your answer.',
      { blooms: 'Analyze', reject: 'Choosing the thick, waxy leaf, or giving no reason, earns no mark.',
        mark_bands: [{ descriptor: 'full: correct choice with valid reasoning', marks: 2 }, { descriptor: 'partial: correct choice without valid reasoning, or valid reasoning with wrong choice', marks: 1 }, { descriptor: 'none', marks: 0 }] }),
    written('A classmate says plants only respire at night. Do you agree? Give a reason for your answer.', { blooms: 'Evaluate' }),
  ], 'Long Answers': [written('A plant.\n(a) Name it.\n(b) Explain it.\n(c) Design a test.', { marks: 3, part_levels: ['Remember', 'Apply', 'Create'] })] },
} });

const reply = { items: [
  { n: 1, distractors: [], level_off: [{ part: null, tagged: 'Understand', really: 'Remember' }], self_answer: true, why: 'the stem names the xylem' },
  { n: 2, level_off: [], self_answer: true, scheme_conflict: false, why: 'the stem names the shoot system the answer needs' },
  { n: 3, level_off: [], self_answer: false, scheme_conflict: true, why: 'watering more often does not reduce water loss' },
  { n: 4, level_off: [], scheme_conflict: true, why: 'the partial band awards a wrong choice the do-not-accept line refuses' },
  { n: 5, level_off: [{ part: null, tagged: 'Evaluate', really: 'Evaluate' }], scheme_conflict: true, why: 'bands contradict reject' },
  { n: 6, level_off: [{ part: 'b', tagged: 'Apply', really: 'Remember' }], scheme_conflict: false },
] };

describe('issuesFrom on written items', () => {
  const out = Review.issuesFrom(reply, paper(), []);
  const of = (check) => out.filter((i) => i.check === check).map((i) => i.n);

  it('raises scheme-conflict for G7 Q12, Q17 and Q18 (accept a wrong answer, bands against do-not-accept)', () => {
    expect(of('scheme-conflict')).toEqual([3, 4, 5]);
    expect(out.find((i) => i.n === 3).text).toMatch(/watering more often does not reduce water loss/);
  });

  it('raises self-answer for G7 Q8 (the stem names the shoot system) and for an MCQ whose stem gives its key away', () => {
    expect(of('self-answer')).toEqual([1, 2]);
  });

  it('raises level-off only where the level really differs, and asks for a rewrite to the tagged level, not a retag', () => {
    expect(of('level-off')).toEqual([1, 6]);
    const part = out.find((i) => i.n === 6 && i.check === 'level-off');
    expect(part.text).toMatch(/part \(b\)/);
    expect(part.text).toMatch(/rewrite it so it really demands Apply/);
    expect(part.text).toMatch(/do not change the tag/);
  });

  it('ignores a scheme_conflict on an MCQ', () => {
    const r = { items: [{ n: 1, distractors: [], scheme_conflict: true }] };
    expect(Review.issuesFrom(r, paper(), [])).toEqual([]);
  });
});

describe('review sends written items to the model', () => {
  it('reviews a paper with no MCQs at all', async () => {
    const p = paper();
    p.unseen.objective = {};
    const ask = jest.fn(async () => ({ items: [{ n: 2, scheme_conflict: true, why: 'w' }] }));
    const out = await Review.review({ examJson: p, grade: 7, ask });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toMatch(/watering more often/);
    expect(out.map((i) => i.check)).toEqual(['scheme-conflict']);
  });
});

describe('stillOpen on written items', () => {
  it('keeps a scheme-conflict open until the scheme changes, and a level-off open after a retag alone', () => {
    const p = paper();
    const out = Review.issuesFrom(reply, p, []);
    const sa = p.unseen.subjective['Short Answers'];
    sa[1].blooms = 'Remember';
    sa[2].reject = 'Choosing the thick leaf earns no mark; a wrong choice earns no mark.';
    p.unseen.subjective['Long Answers'][0].part_levels = ['Remember', 'Remember', 'Create'];
    const open = Review.stillOpen(p, out).map((i) => `${i.n}:${i.check}`);
    expect(open).toContain('3:scheme-conflict');
    expect(open).not.toContain('4:scheme-conflict');
    expect(open).toContain('6:level-off');
  });
});
