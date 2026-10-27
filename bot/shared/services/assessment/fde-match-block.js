'use strict';
/**
 * What a Grade 1-2 match question prints as (bd-5jmnfj.4.23): two columns, the numbered stems
 * and their answers in another order, with a gap between for the child to draw a line.
 * Pure: strings in, strings out. The renderer escapes and numbers the cells.
 */

/**
 * Column B (bd-5jmnfj.4.47): the first mix of the sorted answers, so it never follows the order
 * the pairs were written in, where no answer sits beside its own stem and, from four pairs up,
 * the column is not the key shifted by some rows (v21 printed each answer one row down).
 * Three pairs have no such mix: both of theirs are shifts.
 */
function matchOrder(answers) {
  const n = answers.length;
  const base = [...answers].sort((x, y) => String(x).localeCompare(String(y)));
  if (n < 2) return base;
  const shifted = (out) => answers.some((_, k) => k > 0 && out.every((a, i) => a === answers[(i + k) % n]));
  const fits = (out) => out.every((a, i) => a !== answers[i]) && (n < 4 || !shifted(out));
  let found = null;
  const walk = (out, left) => {
    if (found) return;
    if (!left.length) {
      if (fits(out)) found = out;
      return;
    }
    left.forEach((a, j) => {
      if (a === answers[out.length] || (j > 0 && a === left[j - 1])) return;
      walk([...out, a], [...left.slice(0, j), ...left.slice(j + 1)]);
    });
  };
  if (n <= 8) walk([], base);
  return found || base;
}

const ARROW = /→|←|->|<-|⇒|=>/;

/**
 * What an item prints in Column B and the key (bd-5jmnfj.4.43): its own Column B, else its answer.
 * v19 wrote the answer as the joined pair "اونٹ → صحرا", which printed every pair already matched.
 */
function matchAnswer(q) {
  const b = Array.isArray(q.column_b) ? String(q.column_b[0] ?? '').trim() : '';
  if (b) return b;
  const parts = String(q.answer ?? '').split(ARROW);
  return parts[parts.length - 1].trim();
}

/** A match answer is Column B alone, never the pair with an arrow. */
const noArrow = (q) => !ARROW.test(String(q.answer ?? ''));

/** One row per pair: stem, gap, Column B. Cells arrive as HTML. */
function matchTable(stems, column) {
  const rows = stems.map((s, i) => `<tr><td class="m-a">${s}</td><td class="m-gap"></td><td class="m-b">${column[i] || ''}</td></tr>`);
  return `<table class="match-table">${rows.join('')}</table>`;
}

const MATCH_CSS = `
  table.match-table { border-collapse: collapse; margin: 3px 0; break-inside: avoid; }
  table.match-table td { padding: 2mm 0; vertical-align: middle; }
  table.match-table td.m-gap { width: 40mm; }
`;

module.exports = { matchOrder, matchTable, matchAnswer, noArrow, MATCH_CSS };
