'use strict';

/**
 * Child test — which measurement window a date is in. A cycle is a calendar quarter in Pakistan
 * time (UTC+5, no daylight saving), so a visit at 00:30 on 1 January belongs to the new quarter.
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const CYCLE_PREFIX = 'ICT';

function pktParts(date) {
  const d = new Date((date instanceof Date ? date.getTime() : new Date(date).getTime()) + PKT_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** @returns {string} e.g. 'ICT-2026-Q4' */
function cycleFor(date = new Date()) {
  const { year, month } = pktParts(date);
  return `${CYCLE_PREFIX}-${year}-Q${Math.ceil(month / 3)}`;
}

/** The roster's academic session (classes.session_code): August to July, e.g. '2026-2027'. */
function sessionCodeFor(date = new Date()) {
  const { year, month } = pktParts(date);
  const start = month >= 8 ? year : year - 1;
  return `${start}-${start + 1}`;
}

module.exports = { cycleFor, sessionCodeFor, CYCLE_PREFIX };
