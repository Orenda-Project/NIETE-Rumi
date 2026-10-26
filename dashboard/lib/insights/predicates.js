'use strict';
/**
 * FICO_CROSSWALK rule 2 on one lesson's moves (required move = counted = true; O5). The same predicate as x-data's
 * governed query (Q2b_last28d.sql:40-52), so the rollups reproduce its numbers (B14):
 *   graded  := at least one counted move in the phase(s) is done, partial or not_done (all not_adjudicable → outside)
 *   skipped := graded, none done or partial, at least one not_done
 *   done    := at least one counted move executed or substituted (equivalent / better)
 *   full    := every counted move in the phase(s) done
 * Moves are allow-list moves ({phase, verdict, counted}).
 */
const { DONE_VERDICTS, DONE_OR_PARTIAL_VERDICTS, NOT_DONE } = require('./constants');

function phaseOutcome(moves, phases) {
  const set = Array.isArray(phases) ? phases : [phases];
  let req = 0; let doneAny = 0; let nd = 0; let full = 0; let partial = 0;
  for (const m of moves || []) {
    if (!m || m.counted !== true || !set.includes(m.phase)) continue;
    req += 1;
    if (DONE_OR_PARTIAL_VERDICTS.includes(m.verdict)) doneAny += 1;
    if (DONE_VERDICTS.includes(m.verdict)) full += 1;
    if (m.verdict === 'partial') partial += 1;
    if (m.verdict === NOT_DONE) nd += 1;
  }
  const graded = doneAny > 0 || nd > 0;
  return {
    graded,
    skipped: graded && doneAny === 0 && nd > 0,
    done: full > 0,
    full: req > 0 && full === req,
    partial: graded && partial > 0,
  };
}

const skipped = (moves, phases) => phaseOutcome(moves, phases).skipped;
const done = (moves, phases) => phaseOutcome(moves, phases).done;

module.exports = { phaseOutcome, skipped, done };
