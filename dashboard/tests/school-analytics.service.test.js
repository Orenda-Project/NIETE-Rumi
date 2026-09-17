/**
 * bd-60117 — school-level analytics for a principal (TDD, red-first).
 *
 * The teacher Analytics page aggregates ONE teacher's own sessions. A principal
 * needs the same question asked of her whole school, so this summarises the
 * school's terminal coaching sessions: how many, the average score, the trend
 * over time, and which domains the school is strongest and weakest in.
 *
 * Two facts measured on NIETE prod (2026-09-17) shape this, and both rule out
 * copying the teacher page's maths:
 *
 *  1. NIETE stores NO goal1_total..goal5_total. The teacher page's six
 *     hardcoded goal areas (Formative Assessment / Student Engagement / ... at
 *     maxes 22/22/38/5/21/15) are upstream shape that NIETE never writes, so on
 *     this data every one of them would render a confident 0%. Real per-area
 *     scores live in analysis_data.domains as {domain_score, domain_max}.
 *
 *  2. There is no single domain SET. Across 200 sessions: student_engagement
 *     197, lesson_plan_fidelity / high_leverage_practices /
 *     teacher_subject_knowledge 182 each, and a separate older quartet
 *     (lesson_structure, classroom_climate, assessment_feedback,
 *     instructional_quality) 15 each. So domains are DISCOVERED from the data,
 *     never enumerated in code, and each is averaged over the sessions that
 *     actually contain it — otherwise a domain present in 15 of 200 sessions
 *     reads as a catastrophic weakness rather than a different rubric.
 */

const { summarizeSchoolAnalytics } = require('../services/school-analytics.service');

const sess = (date, pct, domains) => ({
  created_at: date,
  analysis_data: {
    scores: { overall_marks: pct, overall_max_marks: 100, overall_percentage: pct },
    ...(domains ? { domains } : {}),
  },
});

const D = (score, max) => ({ domain_score: score, domain_max: max, indicators: [] });

describe('summarizeSchoolAnalytics', () => {
  it('returns an explicit empty shape when the school has no scored sessions', () => {
    const out = summarizeSchoolAnalytics([]);
    expect(out.totalSessions).toBe(0);
    expect(out.averageScore).toBeNull();      // null, NOT 0 — "no data" is not "zero percent"
    expect(out.scoreTrend).toEqual([]);
    expect(out.domainBreakdown).toEqual([]);
    expect(out.strongestDomain).toBeNull();
    expect(out.focusDomain).toBeNull();
  });

  it('counts sessions and averages the framework-agnostic percentage', () => {
    const out = summarizeSchoolAnalytics([
      sess('2026-08-01T00:00:00Z', 60),
      sess('2026-08-02T00:00:00Z', 80),
    ]);
    expect(out.totalSessions).toBe(2);
    expect(out.averageScore).toBe(70);
  });

  it('builds a chronological trend, oldest first, regardless of input order', () => {
    const out = summarizeSchoolAnalytics([
      sess('2026-09-01T00:00:00Z', 75),
      sess('2026-07-01T00:00:00Z', 55),
      sess('2026-08-01T00:00:00Z', 65),
    ]);
    expect(out.scoreTrend.map((p) => p.percentage)).toEqual([55, 65, 75]);
  });

  it('discovers domains from the data and averages each over the sessions that HAVE it', () => {
    const out = summarizeSchoolAnalytics([
      sess('2026-08-01T00:00:00Z', 70, { student_engagement: D(10, 20), lesson_plan_fidelity: D(15, 20) }),
      // second session lacks lesson_plan_fidelity — it must not be averaged as a zero
      sess('2026-08-02T00:00:00Z', 70, { student_engagement: D(20, 20) }),
    ]);
    const byKey = Object.fromEntries(out.domainBreakdown.map((d) => [d.key, d]));
    expect(byKey.student_engagement.percentage).toBe(75);   // (50 + 100) / 2
    expect(byKey.student_engagement.sessions).toBe(2);
    expect(byKey.lesson_plan_fidelity.percentage).toBe(75); // 15/20, from its ONE session
    expect(byKey.lesson_plan_fidelity.sessions).toBe(1);
  });

  it('names domains for humans rather than leaking the snake_case key', () => {
    const out = summarizeSchoolAnalytics([
      sess('2026-08-01T00:00:00Z', 70, { student_engagement: D(10, 20) }),
    ]);
    expect(out.domainBreakdown[0].name).toBe('Student Engagement');
  });

  it('names the strongest and the focus domain', () => {
    const out = summarizeSchoolAnalytics([
      sess('2026-08-01T00:00:00Z', 70, {
        student_engagement: D(18, 20),      // 90%
        lesson_plan_fidelity: D(8, 20),     // 40%  <- weakest
        high_leverage_practices: D(14, 20), // 70%
      }),
    ]);
    expect(out.strongestDomain).toBe('Student Engagement');
    expect(out.focusDomain).toBe('Lesson Plan Fidelity');
  });

  it('ignores a domain with a zero or missing max instead of dividing by zero', () => {
    const out = summarizeSchoolAnalytics([
      sess('2026-08-01T00:00:00Z', 70, { broken: D(5, 0), fine: D(10, 20) }),
    ]);
    expect(out.domainBreakdown.map((d) => d.key)).toEqual(['fine']);
  });

  it('skips sessions with no usable score rather than counting them as zero', () => {
    const out = summarizeSchoolAnalytics([
      sess('2026-08-01T00:00:00Z', 80),
      { created_at: '2026-08-02T00:00:00Z', analysis_data: null },
      { created_at: '2026-08-03T00:00:00Z', analysis_data: { scores: {} } },
    ]);
    expect(out.totalSessions).toBe(1);
    expect(out.averageScore).toBe(80);
  });
});
