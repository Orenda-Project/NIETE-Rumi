'use strict';
/**
 * The grade gate (G6-12 contract 1, SPEC §1). Pure: no I/O, no imports.
 *
 * Grades 1-5 are never looked at: every function passes them through untouched, whatever the
 * settings say. Grades 6-12 open only when `assessment_grades_6_12` admits the user, and both
 * failure modes hide: an unreadable flag is OFF, and an unreadable kill row that EXISTS kills
 * all of 6-12 (someone wrote it to hide something; ignoring a typo would leave the grade live).
 *
 * `flag`, `kill`, `killCells` are the `app_settings.value` of the three keys as read (undefined
 * when the row is absent). A string value is JSON-decoded once; if that throws the raw string stays.
 */

const BAND = /^(6|7|8|9|10|11|12)$/;
const CELL = /^(6|7|8|9|10|11|12):[a-z_]+$/;
const ALL = 'all';

function decode(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return value; }
}

/** An integer grade, or NaN for anything else (null, '', fractions, objects). */
function gradeNumber(grade) {
  let n = NaN;
  if (typeof grade === 'number') n = grade;
  else if (typeof grade === 'string' && grade.trim() !== '') n = Number(grade);
  return Number.isInteger(n) ? n : NaN;
}

/** The one place that reads the flag: `true`/`"true"` admits any user; a list admits the ids it holds. */
function isSixTwelveAdmitted(flag, userId) {
  if (typeof userId !== 'string' || userId === '') return false;
  const value = decode(flag);
  if (value === true) return true;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  if (Array.isArray(value)) return value.some((id) => typeof id === 'string' && id === userId);
  return false;
}

/** The killed grades as a Set, or ALL when a kill row exists but is not a list. */
function killedGrades(kill) {
  const value = decode(kill);
  if (value === undefined || value === null) return new Set();
  if (!Array.isArray(value)) return ALL;
  return new Set(value.filter((g) => BAND.test(String(g)) && (typeof g === 'number' || typeof g === 'string')).map(Number));
}

/** The killed `grade:subject` cells as a Set, or ALL when a kill-cells row exists but is not a list. */
function killedCells(killCells) {
  const value = decode(killCells);
  if (value === undefined || value === null) return new Set();
  if (!Array.isArray(value)) return ALL;
  return new Set(value.filter((c) => typeof c === 'string' && CELL.test(c)));
}

function bandAllowed(n, flag, killed, userId) {
  return isSixTwelveAdmitted(flag, userId) && killed !== ALL && !killed.has(n);
}

function gradeAllowed(grade, flag, kill, userId) {
  const n = gradeNumber(grade);
  if (n < 6) return true;
  if (!(n <= 12)) return false;
  return bandAllowed(n, flag, killedGrades(kill), userId);
}

function cellAllowed(grade, subject, flag, kill, killCells, userId) {
  const n = gradeNumber(grade);
  if (n < 6) return true;
  if (!gradeAllowed(n, flag, kill, userId)) return false;
  if (typeof subject !== 'string' || subject === '') return false;
  const cells = killedCells(killCells);
  return cells !== ALL && !cells.has(`${n}:${subject}`);
}

/** The DB grade list as offered: 1-5 in input order, then admitted 6-12 ascending; element types kept. */
function offeredGrades(dbGrades, flag, kill, killCells, userId) {
  if (!Array.isArray(dbGrades)) return [];
  const killed = killedGrades(kill);
  const seen = new Set();
  const low = [];
  const high = [];
  for (const grade of dbGrades) {
    const n = gradeNumber(grade);
    if (seen.has(n) || !(n <= 12)) continue;
    seen.add(n);
    if (n < 6) low.push(grade);
    else if (bandAllowed(n, flag, killed, userId)) high.push(grade);
  }
  high.sort((a, b) => gradeNumber(a) - gradeNumber(b));
  return low.concat(high);
}

module.exports = { offeredGrades, gradeAllowed, cellAllowed, isSixTwelveAdmitted };
