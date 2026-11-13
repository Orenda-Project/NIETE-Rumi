/**
 * bd-pw1ccr.38 — Ramisha's sheet: topic papers skipped skills on the ticked pages (G1 Maths pp 2-8, G2 Maths
 * pp 216-220) and copied the book's worked examples (G5 Maths pp 218-222, 252). Pure checks, then a re-ask.
 */
const {
  uncoveredSkills, copiedExamples, exampleText, reviewTopicPaper, retryArgs,
} = require('../../../bot/shared/services/assessment/topics/topic-checks');

const SLOS = [
  { code: 'M-02-A', description: 'Read a thermometer' },
  { code: 'M-02-B', description: 'Name times of day' },
  { code: 'M-02-C', description: 'Read a clock' },
];
const paper = (qs) => ({ unseen: { objective: { MCQs: qs } } });

describe('uncoveredSkills', () => {
  test('lists the ticked skills no question carries, in order', () => {
    const p = paper([{ question: 'What time is it?', slo: 'M-02-C' }]);
    expect(uncoveredSkills(p, SLOS)).toEqual(['M-02-A', 'M-02-B']);
  });

  test('looks inside sub-questions and the seen branch', () => {
    const p = { seen: { subjective: { Long: [{ question: 'Q', questions: [{ question: 'a', slo: 'M-02-A' }] }] } },
      unseen: { objective: { Fill: { a: [{ question: 'b', slo: 'M-02-B' }] } } } };
    expect(uncoveredSkills(p, SLOS)).toEqual(['M-02-C']);
  });

  test('no skills → nothing uncovered', () => {
    expect(uncoveredSkills(paper([]), null)).toEqual([]);
  });
});

describe('exampleText', () => {
  test('keeps only the worked example blocks (English or Urdu heading)', () => {
    const t = exampleText('Read this. Example 1: Add 345 and 278. Answer 623. More text. مثال: 12 + 15');
    expect(t).toMatch(/345 and 278/);
    expect(t).toMatch(/12 \+ 15/);
    expect(t).not.toMatch(/^Read this/);
  });

  test('no example on the pages → empty', () => {
    expect(exampleText('A poem about rain')).toBe('');
  });
});

describe('copiedExamples', () => {
  const PAGES = 'Unit 9. Example 3: Find the area of a rectangle 24 cm long and 15 cm wide. Area = 24 × 15 = 360.';

  test('a question with the example\'s own numbers is caught', () => {
    const p = paper([{ question: 'A rectangle is 15 cm wide and 24 cm long. Find its area.' }, { question: 'Find 7 × 8.' }]);
    expect(copiedExamples(p, PAGES)).toEqual(['A rectangle is 15 cm wide and 24 cm long. Find its area.']);
  });

  test('new numbers on the same skill pass', () => {
    expect(copiedExamples(paper([{ question: 'A rectangle is 31 cm long and 12 cm wide. Find its area.' }]), PAGES)).toEqual([]);
  });

  test('a language book with no worked example flags nothing', () => {
    expect(copiedExamples(paper([{ question: 'The cat sat on the mat and looked at the big red ball today.' }]),
      'The cat sat on the mat and looked at the big red ball today.')).toEqual([]);
  });
});

describe('reviewTopicPaper + retryArgs', () => {
  const PAGES = 'Example: 24 × 15 = 360';
  test('clean paper → no re-ask', () => {
    const p = paper(SLOS.map((s) => ({ question: `About ${s.description}`, slo: s.code })));
    const r = reviewTopicPaper(p, { slos: SLOS, pageContent: PAGES });
    expect(r.clean).toBe(true);
    expect(r.score).toBe(0);
  });

  test('gaps and copies → a re-ask that names both, without changing the skill codes', () => {
    const p = paper([{ question: 'Work out 24 × 15.', slo: 'M-02-C' }]);
    const r = reviewTopicPaper(p, { slos: SLOS, pageContent: PAGES });
    expect(r).toMatchObject({ clean: false, uncovered: ['M-02-A', 'M-02-B'], copied: ['Work out 24 × 15.'], score: 3 });
    const next = retryArgs({ slos: SLOS, avoidQuestions: ['old'] }, r);
    expect(next.slos.map((s) => s.code)).toEqual(SLOS.map((s) => s.code));
    expect(next.slos[0].description).toMatch(/Read a thermometer.*at least one question/);
    expect(next.slos[2].description).toBe('Read a clock');
    expect(next.avoidQuestions).toEqual(['old', 'Work out 24 × 15.']);
  });
});
