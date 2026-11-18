'use strict';
/**
 * The writer's final pass (Amena, "ship with note"; 7 Nov 2026 for D22). Checks that stay hard through the rewrites and
 * re-asks, so they drive them, but never fail the paper: whatever is left at the end becomes a paper-level note. Review
 * flags go through MR.soften; D22 method-marks items left answer-only are released here. Mutates and returns checks. Pure.
 */
const MR = require('./mcq-review');
const MM = require('../board-checks/method-marks');
const LT = require('./last-try');

const SHIPPED = [{ check: MM.id, name: MM.name, msg: MM.MSG }];

/** Moves every shortfall item whose first hard check is `check` into a paper_level note; a row left empty goes. */
function release(checks, { check, name, msg }) {
  let moved = 0;
  checks.shortfall = checks.shortfall.filter((row) => {
    const mine = (row.items || []).filter((id) => row.why && row.why[id] === check);
    mine.forEach((id) => {
      checks.notes.push({ check, id, slot: row.slot, msg, paper_level: true });
      row.items = row.items.filter((x) => x !== id);
      delete row.why[id];
      moved += 1;
    });
    return row.items.length > 0;
  });
  const counted = checks.record.per_check && checks.record.per_check[name];
  checks.record.hard = Math.max(0, (checks.record.hard || 0) - (counted ? counted.hard : moved));
  if (counted) counted.hard = 0;
  return checks;
}

/** The final soften: review flags and every SHIPPED check's leftovers become paper-level notes. */
function finalSoften(checks, groups) {
  MR.soften(checks, { groups });
  SHIPPED.forEach((c) => release(checks, c));
  return checks;
}

/**
 * bd-qyi45h.13: the try a still-failing paper keeps. Every try gets the same final soften first (a rewrite's held
 * review flags used to count as hard, so an over-cap restore beat a rewrite that could ship). Then: a clean try, else
 * one that ships on the last try within the cap, else the fewest hard issues; the earlier try wins a tie.
 */
function pickLast(tries, { grade, slots, shortOf, groupsOf }) {
  tries.forEach((t) => finalSoften(t.checks, groupsOf(t.ex)));
  const rank = (t) => {
    const short = shortOf(t.ex);
    if (!t.checks.shortfall.length && !short.length) return 0;
    return LT.canShip(t.checks, { grade, slotsShort: short }) && !LT.overCap(t.checks, slots) ? 1 : 2;
  };
  const ranked = tries.map((t) => ({ t, r: rank(t) }));
  return ranked.reduce((a, b) => (b.r < a.r || (b.r === a.r && b.t.checks.record.hard < a.t.checks.record.hard) ? b : a)).t;
}

module.exports = { SHIPPED, release, finalSoften, pickLast };
