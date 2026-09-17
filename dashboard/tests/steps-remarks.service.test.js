/**
 * bd-60118 — STEPS "S" (Supervisor Remarks) for a principal's school (TDD).
 *
 * The principal AUTHORS these herself via /remark: one per (teacher, cycle),
 * five indicators scored 1..4. Prod 2026-09-17: 17 remarks (all submitted), 85
 * indicator scores, one open cycle ("Quarter 3 Evaluation", Jul 1 – Oct 1).
 *
 * Two things this must get right:
 *
 * 1. ONLY SUBMITTED REMARKS COUNT. supervisor_remark_scores rows are written AS
 *    SHE ANSWERS — three rows means she stopped at question 3 and will resume.
 *    submitted_at is the commit, and the schema comment is explicit that a
 *    fifth score arriving is not the same event as committing. Scoring a
 *    half-finished form would show her a teacher's "result" she never gave.
 *
 * 2. THE MATH IS NOT REDEFINED HERE. remark-rubric.js is the stated single
 *    source of truth for the /20 denominator and the indicator names — "Nothing
 *    may hardcode an indicator name, an anchor string, or the /20 denominator
 *    anywhere else." So this delegates to computeS and reads names from
 *    INDICATORS. The rubric has already been revised twice (7- and 10-indicator
 *    drafts preceded this one), which is exactly why it is not copied.
 */

const { summarizeRemarks } = require('../services/steps-remarks.service');

const full = (scores) => [1, 2, 3, 4, 5].map((o, i) => ({ ordinal: o, score: scores[i] }));

describe('summarizeRemarks', () => {
  it('returns an explicit empty shape when no remark has been submitted', () => {
    const out = summarizeRemarks([]);
    expect(out.submitted).toBe(0);
    expect(out.averagePct).toBeNull();
    expect(out.indicatorBreakdown).toEqual([]);
  });

  it('counts only SUBMITTED remarks — a part-finished form is not a result', () => {
    const out = summarizeRemarks([
      { teacherId: 't1', submittedAt: '2026-09-01T00:00:00Z', scores: full([4, 4, 4, 4, 4]) },
      // she answered 2 of 5 and stopped; submitted_at is null
      { teacherId: 't2', submittedAt: null, scores: [{ ordinal: 1, score: 1 }, { ordinal: 2, score: 1 }] },
    ]);
    expect(out.submitted).toBe(1);
    expect(out.averagePct).toBe(100);   // the abandoned form must not drag it down
  });

  it('delegates the /20 math to the rubric rather than recomputing it', () => {
    // 3+4+4+3+4 = 18 of 20 = 90% — the value remark-rubric.computeS returns.
    const out = summarizeRemarks([
      { teacherId: 't1', submittedAt: '2026-09-01T00:00:00Z', scores: full([3, 4, 4, 3, 4]) },
    ]);
    expect(out.averagePct).toBe(90);
  });

  it('averages across teachers', () => {
    const out = summarizeRemarks([
      { teacherId: 't1', submittedAt: '2026-09-01T00:00:00Z', scores: full([4, 4, 4, 4, 4]) }, // 100
      { teacherId: 't2', submittedAt: '2026-09-02T00:00:00Z', scores: full([2, 2, 2, 2, 2]) }, // 50
    ]);
    expect(out.averagePct).toBe(75);
    expect(out.submitted).toBe(2);
  });

  it('breaks down by indicator, naming each from the rubric', () => {
    const out = summarizeRemarks([
      { teacherId: 't1', submittedAt: '2026-09-01T00:00:00Z', scores: full([4, 2, 4, 4, 4]) },
      { teacherId: 't2', submittedAt: '2026-09-02T00:00:00Z', scores: full([4, 2, 4, 4, 4]) },
    ]);
    const byKey = Object.fromEntries(out.indicatorBreakdown.map((i) => [i.key, i]));
    expect(byKey.score_growth.name).toBe('Professional Growth & Feedback Uptake');
    expect(byKey.score_growth.average).toBe(4);
    expect(byKey.score_collaboration.name).toBe('Collaboration & Peer Support');
    expect(byKey.score_collaboration.average).toBe(2);   // the weak one
  });

  it('names the weakest indicator as the focus', () => {
    const out = summarizeRemarks([
      { teacherId: 't1', submittedAt: '2026-09-01T00:00:00Z', scores: full([4, 4, 1, 4, 4]) },
    ]);
    expect(out.focusIndicator).toBe('Initiative & School Leadership');
  });

  it('skips an incomplete SUBMITTED form rather than scoring it out of 20', () => {
    // Defensive: submitted_at set but a score row missing. computeS requires a
    // complete set, and scoring 4 answers against a /20 denominator would
    // silently report 80% as 60%.
    const out = summarizeRemarks([
      { teacherId: 't1', submittedAt: '2026-09-01T00:00:00Z', scores: [{ ordinal: 1, score: 4 }] },
      { teacherId: 't2', submittedAt: '2026-09-02T00:00:00Z', scores: full([4, 4, 4, 4, 4]) },
    ]);
    expect(out.averagePct).toBe(100);
    expect(out.submitted).toBe(1);
  });
});
