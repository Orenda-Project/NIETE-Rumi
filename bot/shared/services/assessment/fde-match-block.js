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
  // Nor, from four up, the key read backwards (bd-5jmnfj.4.50.9): an Urdu box read left to right.
  const backwards = (out) => out.every((a, i) => a === answers[n - 1 - i]);
  const fits = (out) => out.every((a, i) => a !== answers[i]) && (n < 4 || (!shifted(out) && !backwards(out)));
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
  if (n <= 10) walk([], base); // ten, not eight: G1 English Q7 boxes nine words (bd-5jmnfj.4.50.9)
  return found || base;
}

/**
 * A word box (bd-5jmnfj.4.50.9): dealt like Column B against the items' own answers. v22 sorted
 * it, and the sort printed G1 Urdu Q4's third word over the third picture, the rest in item order
 * read backwards. A box that is not one word per item stays sorted as before.
 */
function bankOrder(words, answers) {
  const sorted = [...words].sort((x, y) => String(x).localeCompare(String(y)));
  const keyed = answers.filter((a, i) => words.includes(a) && answers.indexOf(a) === i);
  return keyed.length === answers.length && keyed.length === words.length ? matchOrder(keyed) : sorted;
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

/**
 * What an item prints in Column A (bd-5jmnfj.33.2): its own Column A, else its question. v30 G3
 * General Knowledge Q2 wrote the instruction as every item's question and the term in column_a,
 * so the paper printed "کالم الف کو کالم ب سے ملائیں۔" five times with nothing to match.
 */
function matchStem(q) {
  if (!q) return '';
  const a = Array.isArray(q.column_a) ? String(q.column_a[0] ?? '').trim() : '';
  return a || String(q.question ?? '');
}

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

module.exports = { matchOrder, bankOrder, matchTable, matchAnswer, matchStem, noArrow, MATCH_CSS };
