'use strict';
/**
 * bd-5jmnfj.38.34 — ids of the MCQs that sit inside a stimulus group. A review fault on one of them is held hard
 * while the writer re-asks the group (ATTEMPTS times); one still left after that ships as a paper-level note. Pure.
 */
const { leaves } = require('../board-checks/walk');

/** Set of item ids whose leaf sits inside a stimulus group. */
function memberIds(examJson) {
  const out = new Set();
  leaves(examJson).forEach((l) => { if (l.stimulus != null && l.item && l.item.id != null) out.add(l.item.id); });
  return out;
}

/** Of the review-flagged ids still in `checks`, those inside a stimulus group of `examJson`. */
function stuck(checks, examJson) {
  const members = memberIds(examJson);
  return new Set(checks.shortfall.flatMap((r) => Object.keys(r.review || {}).filter((id) => members.has(id))));
}

/** Re-asks of a stuck group before its fault is shipped as a paper-level note. */
const ATTEMPTS = 3;

module.exports = { memberIds, stuck, ATTEMPTS };
