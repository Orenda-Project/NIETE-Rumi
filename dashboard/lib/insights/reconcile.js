'use strict';
/**
 * B14 reconcile (NIGHTLY_JOB §11). Per phase, skipped and graded lessons over self-recordings at ICT schools, lp facts
 * with status ok, not unusable and not a mismatch, with the governed predicate of x-data Q2b_last28d.sql (rule 2,
 * predicates.phaseOutcome). Dedup on drops `is_duplicate` (Q8). `from` and `to` are Karachi days, both inclusive
 * (Q2b's END is exclusive: to = END − 1 day).
 */
const C = require('./constants');
const { phaseOutcome } = require('./predicates');

const PHASES = Object.freeze(['warm_up', 'hook', 'recall', 'announce', 'explain', 'guided', 'independent', 'peer_review', 'exit', 'homework']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function reconcile(facts, { from, to, dedup } = {}) {
  if (!DAY.test(String(from)) || !DAY.test(String(to))) throw new Error('reconcile needs from and to (YYYY-MM-DD)');
  const totals = PHASES.map((phase) => ({ phase, skipped: 0, graded: 0 }));
  for (const f of facts || []) {
    if (f.framework_version !== 'lp_fidelity' || f.status !== 'ok' || f.is_unusable || f.is_mismatch) continue;
    if (f.is_observed || !C.SECTORS.includes(f.sector)) continue;
    if (!(f.karachi_date >= from && f.karachi_date <= to)) continue;
    if (dedup && f.is_duplicate) continue;
    const moves = (f.allowed && f.allowed.lp && f.allowed.lp.moves) || [];
    for (const t of totals) {
      const o = phaseOutcome(moves, t.phase);
      if (o.graded) t.graded += 1;
      if (o.skipped) t.skipped += 1;
    }
  }
  return totals;
}

module.exports = { reconcile, PHASES };
