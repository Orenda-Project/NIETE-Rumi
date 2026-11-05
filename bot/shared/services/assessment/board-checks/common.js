'use strict';
// Small shared helpers for the board-checks members (pure).

/** Quarter-marks: 0.5-mark MCQs and 2.5-mark parts add exactly (check_paper.py:31-33). */
const q = (x) => Math.round(4 * Number(x || 0));

/** Issue per contract 8 §1, plus `rule` (the sub-rule name) and optional `slot`. */
function issue(check, rule, item_ref, msg, hard, slot) {
  const out = { check, rule, item_ref, msg: `${rule}: ${msg}`, hard: !!hard };
  if (slot !== undefined) out.slot = slot;
  return out;
}

module.exports = { q, issue };
