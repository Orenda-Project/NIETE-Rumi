/**
 * bd-5jmnfj.38.31 — the review call on a generated paper has its own registry job, `assessment.review`
 * (approved by Amena, 2026-11-06). Its default is of another model family than the paper writer's
 * default, so a review does not share the writer's blind spots, and its registered alternative is of a
 * third family's or the writer's, so a writer moved onto the reviewer's family still gets a review of
 * another family. Named generically: the board papers (.38.30) reuse it.
 */
const { JOBS, FALLBACK, fallbackForJob, resolveModelForJob } = require('../../bot/shared/config/model-registry');

const family = (m) => String(m).split('/')[0];

describe('assessment.review in the model registry', () => {
  const saved = process.env.ASSESSMENT_REVIEW_MODEL;
  beforeEach(() => { delete process.env.ASSESSMENT_REVIEW_MODEL; });
  afterAll(() => { if (saved === undefined) delete process.env.ASSESSMENT_REVIEW_MODEL; else process.env.ASSESSMENT_REVIEW_MODEL = saved; });

  it('is a routed job with its own variable and a call site', () => {
    expect(JOBS['assessment.review']).toMatchObject({ env: 'ASSESSMENT_REVIEW_MODEL' });
    expect(JOBS['assessment.review'].site).toMatch(/assessment/);
    expect(Object.keys(FALLBACK)).toContain('assessment.review');
  });

  it('defaults to another model family than the default paper writer', () => {
    const writer = JOBS['assessment.generate'].default;
    expect(family(resolveModelForJob('assessment.review').model)).not.toBe(family(writer));
  });

  it('has a registered alternative of another family than its default', () => {
    const alt = fallbackForJob('assessment.review');
    expect(alt).toMatch(/\//);
    expect(family(alt)).not.toBe(family(JOBS['assessment.review'].default));
  });

  it('moves with its own variable', () => {
    process.env.ASSESSMENT_REVIEW_MODEL = 'openai/gpt-5.4';
    expect(resolveModelForJob('assessment.review').model).toBe('openai/gpt-5.4');
  });
});
