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

/** Of the review-flagged or key-leaking (N18, bd-qyi45h.6) ids still in `checks`, those inside a stimulus group of
 * `examJson`: dropIds takes a leaking child's whole group and the restore never refills one, so only a re-ask clears it.
 * Plus every D18 item (the key stands out; bd-qyi45h.4) and every D17 item (asks the same as another; bd-qyi45h.14),
 * in a group or not: nothing after rewrite 1 re-asks them otherwise, and neither ships as a last-try note. */
function stuck(checks, examJson) {
  const members = memberIds(examJson);
  const leaking = (r) => Object.keys(r.why || {}).filter((id) => r.why[id] === 'N18');
  const cue = (r) => Object.keys(r.why || {}).filter((id) => r.why[id] === 'D18' || r.why[id] === 'D17');
  return new Set(checks.shortfall.flatMap((r) => [...[...Object.keys(r.review || {}), ...leaking(r)].filter((id) => members.has(id)), ...cue(r)]));
}

/** The leaked phrases whose quoting item is in `ids`, once each, for the re-ask's "do not use" line. */
function leakPhrases(checks, ids) {
  const out = checks.shortfall.flatMap((r) => (r.keyed || []).filter((k) => ids.has(k.holder) && k.phrase).map((k) => k.phrase));
  return [...new Set(out)];
}

/** Re-asks of a stuck group before its fault is shipped as a paper-level note. */
const ATTEMPTS = 3;

module.exports = { memberIds, stuck, leakPhrases, ATTEMPTS };
