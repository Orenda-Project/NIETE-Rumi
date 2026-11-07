'use strict';
/**
 * bd-5jmnfj.38.35 (A5e) — sizing turns extended answers into short ones to fit the band's time (a7
 * ruling: the count is kept). The conversion must not be silent: this lists every question type planned
 * below what the teacher asked for, as an n:0 issue (the rewrite ignores it; it shows in issues and logs).
 * Pure.
 */

const countOf = (types, id) => ((types || []).find((t) => t.id === id) || {}).count || 0;

/** One issue per type whose planned count is under the requested count. */
function typeShortfall(requested, planned) {
  return (requested || []).map((t) => ({ id: t.id, requested: Number(t.count) || 0, planned: countOf(planned, t.id) }))
    .filter((t) => t.planned < t.requested)
    .map((t) => ({ n: 0, check: 'type-shortfall', ...t,
      text: `${t.id}: ${t.requested} asked, ${t.planned} written; converted to fit the paper's time` }));
}

module.exports = { typeShortfall };
