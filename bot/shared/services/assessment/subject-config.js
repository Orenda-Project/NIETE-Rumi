'use strict';
/**
 * The grade x subject registry for grades 6-12 (G612 contract 2, subject-config.md).
 *
 * Pure data and lookups, no I/O. One row per (grade, code) says what that cell is: its label, its
 * medium, the prompt key, the type set, the default table of specification, the board, whether the
 * TYPES list offers a board paper, and which book it reads. Grades 1-5 never come here: every
 * function answers null or [] for them, so no G1-5 path can change by calling it.
 *
 * Only `status: 'core'` rows are offered or generated. A `book_pending` or `design_pending` row is
 * listed by name (reports, the go package) and resolving it throws, so a caller can say what is
 * missing but can never generate a paper for it.
 */

const ROWS = require('./subject-config/index');

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}
deepFreeze(ROWS);

const FIRST = 6;
const GRADES = new Set(ROWS.map((r) => r.grade));
const BY_CELL = new Map(ROWS.map((r) => [`${r.grade}:${r.code}`, r]));

/** 6..12 as a number, or null for anything else (including 1-5). */
function gradeOf(grade) {
  const n = Number(grade);
  return GRADES.has(n) ? n : null;
}

/** True for a grade the registry does not cover from below: 1-5 (and 0) stay with the old code. */
function isPrimary(grade) {
  if (grade === null || grade === undefined || grade === '') return false;
  const n = Number(grade);
  return Number.isFinite(n) && n < FIRST;
}

function codeOf(code) {
  return String(code ?? '').trim().toLowerCase();
}

function unknown(grade, subject, row) {
  const err = new Error(`SUBJECT_UNKNOWN: grade ${grade} has no generated subject "${subject}"`);
  err.code = 'SUBJECT_UNKNOWN';
  err.grade = grade;
  err.subject = subject;
  if (row) {
    err.status = row.status;
    err.reason = row.reason;
  }
  return err;
}

/**
 * The core row for (grade, code). Grade <= 5 returns null and never throws. Any other grade or
 * code that is not a core row throws SUBJECT_UNKNOWN; a pending row's error carries its status
 * and reason. No aliasing: `science` at grade 7 is unknown.
 */
function resolve(grade, code) {
  if (isPrimary(grade)) return null;
  const g = gradeOf(grade);
  const c = codeOf(code);
  const row = g === null ? undefined : BY_CELL.get(`${g}:${c}`);
  if (row && row.status === 'core') return row;
  throw unknown(g === null ? grade : g, c, row);
}

/** Every row of the grade, pending ones included. */
function listed(grade) {
  const g = gradeOf(grade);
  return g === null ? [] : ROWS.filter((r) => r.grade === g);
}

/** The core rows of the grade, in registry order. */
function offered(grade) {
  return listed(grade).filter((r) => r.status === 'core');
}

/** label_en, or label_ur for lang 'ur'; null for grade <= 5 or a cell the registry does not list. */
function label(grade, code, lang = 'en') {
  const g = gradeOf(grade);
  const row = g === null ? undefined : BY_CELL.get(`${g}:${codeOf(code)}`);
  if (!row) return null;
  return lang === 'ur' ? row.label_ur : row.label_en;
}

/** Every code the registry knows, pending rows included. */
function codes() {
  return new Set(ROWS.map((r) => r.code));
}

/** All rows, frozen, in contract order. */
function rows() {
  return ROWS;
}

module.exports = { resolve, listed, offered, label, codes, rows };
