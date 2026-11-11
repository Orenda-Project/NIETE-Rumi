'use strict';
/**
 * The last try of a G9-12 board paper (bd-qyi45h.3, option a; Amena, 11 Nov 2026). When every rewrite is spent, a
 * complete paper whose only hard issues are question-quality flaws ships with paper-level notes instead of failing:
 * D12 LEVEL_OVER (too many questions at one level), D18 (the key stands out) and N18 KEY_IN_STEM (an answer quoted in
 * another stem). A short slot, a structural D12 rule (totals, slot counts), a numeric answer or any other check still
 * fails the paper. Grades 6-8 are unchanged. Pure: mutates and returns the checks it is given.
 */
const SOFT = { D12: new Set(['LEVEL_OVER']), D18: null, N18: new Set(['KEY_IN_STEM']) }; // null = any rule of that check
const MIN_GRADE = 9;

const MSG = {
  D12: 'more questions at this level than the board split allows; shipped on the last try',
  D18: 'the correct option stands out from the distractors; shipped on the last try',
  N18: 'the answer to this item appears in another item\'s wording; shipped on the last try',
};

const checksLeft = (rows) => new Set(rows.flatMap((r) => [r.reason, ...Object.values(r.why || {})]));

/** True when this failing paper may ship with notes: G9-12, no slot short, every row names items, every rule left is soft. */
function canShip(checks, { grade, slotsShort }) {
  const rows = (checks && checks.shortfall) || [];
  if (Number(grade) < MIN_GRADE || !rows.length || (slotsShort && slotsShort.length)) return false;
  if (rows.some((r) => !(r.items || []).length)) return false;
  const left = checksLeft(rows);
  if (![...left].every((c) => Object.prototype.hasOwnProperty.call(SOFT, c))) return false;
  return Object.keys((checks.record && checks.record.hard_rules) || {}).every((k) => {
    const [c, rule] = k.split(' ');
    return !left.has(c) || SOFT[c] === null || SOFT[c].has(rule);
  });
}

/** Moves every item left into a paper-level last-try note; the rules shipped stay on the record for the logs. */
function ship(checks) {
  checks.shortfall.forEach((row) => row.items.forEach((id) => {
    const check = (row.why && row.why[id]) || row.reason;
    checks.notes.push({ check, id, slot: row.slot, msg: MSG[check], paper_level: true, last_try: true });
  }));
  checks.shortfall = [];
  checks.record.shipped_last_try = { ...(checks.record.hard_rules || {}) };
  checks.record.hard = 0;
  return checks;
}

module.exports = { SOFT, MIN_GRADE, MSG, canShip, ship };
