/**
 * bd-60118 — STEPS "S" (Supervisor Remarks), aggregated for a principal.
 *
 * These are the principal's OWN quarterly evaluations, authored through
 * /remark: one per (teacher, cycle), five indicators scored 1..4. Prod
 * 2026-09-17: 17 remarks (all submitted), 85 indicator scores, one open cycle
 * ("Quarter 3 Evaluation", Jul 1 – Oct 1).
 *
 * ONLY SUBMITTED REMARKS COUNT. supervisor_remark_scores rows are written as
 * she answers — three rows means she stopped at question 3 and resumes at 4.
 * `submitted_at` is the commit, and the migration is explicit that a fifth
 * score arriving is NOT the same event as committing. Aggregating a form she
 * never finished would show her a teacher's result she never actually gave.
 *
 * THE MATH IS NOT REDEFINED HERE. remark-rubric.js declares itself the single
 * source of truth for the /20 denominator and the indicator names — "Nothing
 * may hardcode an indicator name, an anchor string, or the /20 denominator
 * anywhere else." The rubric has already been revised twice (7- and
 * 10-indicator drafts came before this one), so copying either would guarantee
 * a future divergence. computeS also validates completeness for us.
 */

const {
  INDICATORS,
  computeS,
} = require('../../bot/shared/services/remark/remark-rubric');

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {Array<{teacherId: string, submittedAt: string|null,
 *                scores: Array<{ordinal: number, score: number}>}>} remarks
 */
function summarizeRemarks(remarks) {
  const list = Array.isArray(remarks) ? remarks : [];

  const scored = [];
  for (const r of list) {
    if (!r || !r.submittedAt) continue;            // not committed → not a result
    const scores = Array.isArray(r.scores) ? r.scores : [];
    let s;
    try {
      // computeS throws on an incomplete set rather than scoring 4 answers
      // against a /20 denominator, which would silently report 80% as 60%.
      s = computeS(scores);
    } catch (_) {
      continue;
    }
    scored.push({ teacherId: r.teacherId, submittedAt: r.submittedAt, scores, s_pct: s.s_pct });
  }

  // Per-indicator averages, named from the rubric rather than from a local list.
  const indicatorBreakdown = [];
  if (scored.length > 0) {
    for (const ind of INDICATORS) {
      let sum = 0;
      let n = 0;
      for (const r of scored) {
        const hit = r.scores.find((x) => x.ordinal === ind.ordinal);
        if (!hit || !Number.isFinite(Number(hit.score))) continue;
        sum += Number(hit.score);
        n += 1;
      }
      if (n === 0) continue;
      indicatorBreakdown.push({
        key: ind.key,
        ordinal: ind.ordinal,
        name: ind.name.en,
        average: round1(sum / n),
        // Out of 4, so the UI never has to know the scale.
        percentage: round1((sum / n / 4) * 100),
        teachers: n,
      });
    }
  }

  const weakest = indicatorBreakdown.length
    ? indicatorBreakdown.reduce((lo, i) => (i.average < lo.average ? i : lo))
    : null;

  return {
    submitted: scored.length,
    averagePct: scored.length
      ? round1(scored.reduce((sum, r) => sum + r.s_pct, 0) / scored.length)
      : null,
    indicatorBreakdown,
    focusIndicator: weakest ? weakest.name : null,
  };
}

module.exports = { summarizeRemarks };
