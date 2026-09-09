/**
 * bd-2434 — Framework-agnostic overall coaching score (NIETE port).
 *
 * coaching_sessions.analysis_data stores its headline score under different
 * keys depending on which pipeline wrote it:
 *   - NIETE FICO (/observe → observe-framework.js computeScores):
 *       scores.{overall_marks, overall_max_marks (148), overall_percentage}
 *   - Legacy OECD-shaped rows (gpt5-mini.service):
 *       scores.{overall_marks|grand_total, max_marks, percentage}
 *
 * getOverall normalises all of these into {points, maxPoints, percentage} so
 * portal surfaces (leader patch, dashboard recent-session card) never hardcode
 * one shape. Ported from the upstream dashboard's coaching-frameworks.service —
 * NOTE: only getOverall is ported. The upstream per-framework goal/criterion
 * breakdown builders (buildGoalBreakdown/buildCriterionBreakdown) carry
 * upstream framework metadata (HOTS/TEACH/MEWAKA + a 21-indicator FICO) that
 * does NOT describe NIETE's FICO v3 — port + re-verify those against NIETE
 * analysis rows before using them here.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round1 = (n) => Math.round(num(n) * 10) / 10;
const pct = (score, max) => (max > 0 ? round1((score / max) * 100) : 0);

/**
 * Overall score / max / percentage, robust across every framework's score shape.
 * @returns {{points:number, maxPoints:number, percentage:number}}
 */
function getOverall(analysisData) {
  const s = (analysisData && analysisData.scores) || {};
  const points = num(s.overall_marks != null ? s.overall_marks : s.grand_total);
  // overall_max_marks FIRST, and this order matters.
  //
  // Measured across 172 completed sessions: overall_max_marks equals the sum
  // of the domain maxima on 172 of them, max_marks on ZERO. max_marks sits at
  // a fixed 103 or 117 regardless of the lesson, while FICO's real denominator
  // is computed per session from the subject and from which indicators
  // applied — so preferring it read the headline out of a different scale than
  // the domain bars underneath, and on 4 of 172 sessions overall_marks exceeds
  // max_marks, which renders as a score above 100%.
  //
  // max_marks is kept as the fallback: it is the only max a legacy OECD-shaped
  // row carries, and the leader dashboard reads this same function.
  const maxPoints = num(s.overall_max_marks != null ? s.overall_max_marks : s.max_marks);
  let percentage = s.percentage != null ? s.percentage
    : (s.overall_percentage != null ? s.overall_percentage : null);
  if (percentage == null) percentage = pct(points, maxPoints);
  return { points: round1(points), maxPoints: round1(maxPoints), percentage: round1(percentage) };
}

module.exports = { getOverall };
