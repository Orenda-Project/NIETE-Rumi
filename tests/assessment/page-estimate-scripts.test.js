/**
 * bd-nr8mrm.8 — the scripts that measure the page estimate (portal pageEstimate.ts).
 * calibrate.js counts each paper's questions by type and keeps only plain papers;
 * fit.js solves least squares for the height each type takes.
 */
const { typeCounts, isPlain } = require('../../scripts/assessment/page-estimate/calibrate');
const { leastSquares } = require('../../scripts/assessment/page-estimate/fit');

describe('calibrate: typeCounts', () => {
  it('adds seen and unseen questions of a type together', () => {
    const exam = {
      seen: { objective: { MCQs: [1, 2] }, subjective: { 'Short Questions': [1] } },
      unseen: { objective: { MCQs: [1, 2, 3] }, subjective: { 'Long Questions': [1, 2] } },
    };
    expect(typeCounts(exam)).toEqual({ MCQs: 5, 'Short Questions': 1, 'Long Questions': 2 });
  });

  it('skips empty and non-list blocks', () => {
    const exam = { unseen: { objective: { MCQs: [], 'True/False': 'x' }, subjective: null } };
    expect(typeCounts(exam)).toEqual({});
  });

  it('a missing paper counts nothing', () => {
    expect(typeCounts(undefined)).toEqual({});
  });
});

describe('calibrate: isPlain', () => {
  it('a paper of named types is plain', () => {
    expect(isPlain({ MCQs: 3, 'Short Questions': 2 })).toBe(true);
  });
  it('a board paper (lowercase keys like mcq, srq) is not', () => {
    expect(isPlain({ mcq: 10, srq: 4 })).toBe(false);
    expect(isPlain({ MCQs: 3, srq: 4 })).toBe(false);
  });
  it('an empty paper is not', () => {
    expect(isPlain({})).toBe(false);
  });
});

describe('fit: leastSquares', () => {
  it('recovers a known base and per-type height', () => {
    // y = 600 + 50·a + 200·b, exactly
    const X = [[1, 1, 0], [1, 0, 1], [1, 2, 1], [1, 3, 2], [1, 5, 0], [1, 0, 4]];
    const y = X.map(([, a, b]) => 600 + 50 * a + 200 * b);
    const [base, a, b] = leastSquares(X, y, 0);
    expect(base).toBeCloseTo(600, 6);
    expect(a).toBeCloseTo(50, 6);
    expect(b).toBeCloseTo(200, 6);
  });

  it('the ridge does not shrink the base', () => {
    const X = [[1, 1], [1, 2], [1, 3], [1, 4]];
    const y = X.map(([, a]) => 1000 + 10 * a);
    const [base] = leastSquares(X, y, 1e-2);
    expect(base).toBeCloseTo(1000, 0);
  });
});
