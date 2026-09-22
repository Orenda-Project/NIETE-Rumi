'use strict';
/**
 * Telemetry the grading and the photo reader leave on an analysis — for the 48-hour watch and for audits — which must
 * never reach a prompt that speaks to a person (bd-b3pop, architecture review M1). The teacher's voice note and the
 * coach's debrief guide both serialise the whole analysis into their prompts, so a run's percentage beside the card's,
 * the spread, a photo reading or an excluded upload would all be quotable.
 */
const ANALYSIS_KEYS = ['photo_vision', 'photo_reads', 'photo_evidence'];
const LP_FIDELITY_KEYS = ['runs', 'runs_requested', 'spread', 'recording', 'photo_citations', 'missing_verdicts', 'cause', 'reasoning_effort'];
const MOVE_KEYS = ['photo_guard', 'verdict_before_guard'];

const hasAny = (obj, keys) => !!obj && typeof obj === 'object' && keys.some((k) => Object.prototype.hasOwnProperty.call(obj, k));

function without(obj, keys) {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

/**
 * @param {object} analysis analysis_data
 * @returns {object} the same object when there is nothing to strip, otherwise a copy without the telemetry (the input is
 *                   never mutated)
 */
function stripFidelityTelemetry(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  const lp = analysis.lp_fidelity;
  const moves = lp && Array.isArray(lp.moves) ? lp.moves : null;
  const lpHas = hasAny(lp, LP_FIDELITY_KEYS) || (!!moves && moves.some((m) => hasAny(m, MOVE_KEYS)));
  if (!lpHas && !hasAny(analysis, ANALYSIS_KEYS)) return analysis;
  const out = without(analysis, ANALYSIS_KEYS);
  if (lpHas) {
    const cleanLp = without(lp, LP_FIDELITY_KEYS);
    if (moves) cleanLp.moves = moves.map((m) => (hasAny(m, MOVE_KEYS) ? without(m, MOVE_KEYS) : m));
    out.lp_fidelity = cleanLp;
  }
  return out;
}

module.exports = { stripFidelityTelemetry };
