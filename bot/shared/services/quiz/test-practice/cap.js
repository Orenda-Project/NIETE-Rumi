'use strict';
/**
 * Practice door replay cap: at most ROUNDS_PER_DAY practice rounds per child per Pakistan day (UTC+5, no DST).
 * Pure; the count is read by pool.repo.js.
 */
const ROUNDS_PER_DAY = 3;
const PKT_MS = 5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

function pktDayStart(now = new Date()) {
  const local = now.getTime() + PKT_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - PKT_MS).toISOString();
}

const capped = (roundsToday) => Number(roundsToday) >= ROUNDS_PER_DAY;

module.exports = { ROUNDS_PER_DAY, pktDayStart, capped };
