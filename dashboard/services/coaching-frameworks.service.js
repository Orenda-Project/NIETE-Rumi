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

// bd-ra8xu.38 — a FICO17 v6 score (stamped scores.rubric / analysis framework / observe2.rubric = 'fico17_v6') is
// never a V3 number: V3 C5 is not v6 C5 and V3 is out of 148, v6 out of 44. The same test as the bot's
// coaching/frameworks/fico17-v6/stamp.js, kept here so the dashboard needs no bot module for it.
const V6_RUBRIC = 'fico17_v6';
function isV6Scored(x) {
  if (!x || typeof x !== 'object') return false;
  if (x.rubric === V6_RUBRIC || x.framework === V6_RUBRIC) return true;
  if (x.scores && typeof x.scores === 'object' && x.scores.rubric === V6_RUBRIC) return true;
  if (x.observe2 && typeof x.observe2 === 'object' && x.observe2.rubric === V6_RUBRIC) return true;
  return false;
}

// bd-pni007 — FDE's grade 6-12 observation tools (obs612-<tool>-v<n>) are scored apart from FICO too. The same
// test as the bot's coaching/frameworks/own-rubric.js: is this score on a rubric of its own (v6 or obs612)?
const OBS612_RX = /^obs612-(gen|msci|enur)-v\d+$/;
const isOwnId = (v) => v === V6_RUBRIC || (typeof v === 'string' && OBS612_RX.test(v));
function ownRubricOf(x) {
  if (!x || typeof x !== 'object') return null;
  const tries = [
    x.rubric,
    x.framework,
    x.scores && typeof x.scores === 'object' ? x.scores.rubric : undefined,
    x.observe2 && typeof x.observe2 === 'object' ? x.observe2.rubric : undefined,
  ];
  return tries.find(isOwnId) || null;
}
function isOwnRubric(x) { return ownRubricOf(x) !== null; }

/**
 * Overall score / max / percentage, robust across every framework's score shape.
 * A row on a rubric of its own (FICO17 v6, or an FDE obs612 tool) comes back as "no V3 score" (percentage null,
 * maxPoints 0, rubric = its id): every caller already skips a null percentage or a zero max, so no V3 average or
 * total ever counts it.
 * @returns {{points:number, maxPoints:number, percentage:number|null, rubric?:string}}
 */
function getOverall(analysisData) {
  const own = ownRubricOf(analysisData);
  if (own) return { points: 0, maxPoints: 0, percentage: null, rubric: own };
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

module.exports = { getOverall, isV6Scored, isOwnRubric, ownRubricOf };
