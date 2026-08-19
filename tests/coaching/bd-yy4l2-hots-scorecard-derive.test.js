/**
 * bd-yy4l2 — HOTS scorecard renders 0/N for every area when the analysis stored
 * its indicators under scrambled `goalN_*` OECD-shaped slots instead of `a.areas`.
 *
 * Real case: session 4060e32e (PK, framework=hots) — `analysis_data` had no
 * `areas` key; the indicators lived in goal1_formative_assessment … goal5_*,
 * each carrying its TRUE HOTS indicator id (goal1 held ids 14/15/16 =
 * Assessment & Feedback). The old adapter read only `a.areas`, found nothing,
 * and rendered 0/9 across the board.
 *
 * The fix: re-derive each area's score by summing the scores of its canonical
 * indicator ids wherever they live (a.areas OR any goalN_* bucket). Immune to
 * the bucket scrambling.
 */

const { buildHotsGroups } = require('../../bot/shared/services/coaching/report-v2/score-adapters/hots-adapter');

// Minimal scrambled analysis: OECD-named buckets holding HOTS indicators by id.
// ids 1-3 = Classroom Environment, 4-6 = Lesson Planning, 7-10 = Instructional
// Strategies, 11-13 = Student Engagement, 14-16 = Assessment & Feedback.
const SCRAMBLED = {
  framework: 'hots',
  // NB: no `areas` key at all — this is the failing shape.
  goal1_formative_assessment: { area_max: 9, area_score: 5, indicators: [
    { id: 14, score: 1 }, { id: 15, score: 2 }, { id: 16, score: 2 },   // Assessment & Feedback = 5
  ] },
  goal2_bucket: { indicators: [ { id: 1, score: 3 }, { id: 2, score: 2 }, { id: 3, score: 2 } ] }, // Classroom Env = 7
  goal3_bucket: { indicators: [ { id: 4, score: 2 }, { id: 5, score: 3 }, { id: 6, score: 2 } ] }, // Lesson Planning = 7
  goal4_bucket: { indicators: [ { id: 7, score: 2 }, { id: 8, score: 1 }, { id: 9, score: 2 }, { id: 10, score: 1 } ] }, // Instructional Strategies = 6 / 12
  goal5_bucket: { indicators: [ { id: 11, score: 2 }, { id: 12, score: 2 }, { id: 13, score: 3 } ] }, // Student Engagement = 7
};

describe('bd-yy4l2 — HOTS scorecard re-derives from scrambled goalN_* slots', () => {
  const groups = buildHotsGroups(SCRAMBLED);
  const byName = Object.fromEntries(groups.map((g) => [g.name, g]));

  it('produces all 5 areas with the correct maxes', () => {
    expect(groups).toHaveLength(5);
    expect(byName['Instructional Strategies'].max).toBe(12); // 4 indicators × 3
    expect(byName['Classroom Environment'].max).toBe(9);
  });

  it('re-derives each area score from its canonical indicator ids (NOT 0)', () => {
    expect(byName['Classroom Environment'].score).toBe(7);
    expect(byName['Lesson Planning'].score).toBe(7);
    expect(byName['Instructional Strategies'].score).toBe(6);
    expect(byName['Student Engagement'].score).toBe(7);
    expect(byName['Assessment & Feedback'].score).toBe(5);
  });

  it('does NOT leave any area at 0 when indicator data exists somewhere', () => {
    expect(groups.every((g) => g.score > 0)).toBe(true);
  });

  it('still honours a clean a.areas shape when present (no regression)', () => {
    const clean = { framework: 'hots', areas: {
      classroom_environment: { area_score: 8, area_max: 9 },
      lesson_planning: { area_score: 6, area_max: 9 },
      instructional_strategies: { area_score: 10, area_max: 12 },
      student_engagement: { area_score: 5, area_max: 9 },
      assessment_feedback: { area_score: 7, area_max: 9 },
    } };
    const g = Object.fromEntries(buildHotsGroups(clean).map((x) => [x.name, x]));
    expect(g['Classroom Environment'].score).toBe(8);
    expect(g['Instructional Strategies'].score).toBe(10);
  });
});
