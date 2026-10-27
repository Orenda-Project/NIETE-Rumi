'use strict';
/**
 * What a Grade 1-2 match question prints as (bd-5jmnfj.4.23): two columns, the numbered stems
 * and their answers in another order, with a gap between for the child to draw a line.
 * Pure: strings in, strings out. The renderer escapes and numbers the cells.
 */

/**
 * Column B: sorted, so it never follows the order the pairs were written in. An answer left
 * beside its own stem swaps with one that can take its place.
 */
function matchOrder(answers) {
  const out = [...answers].sort((x, y) => String(x).localeCompare(String(y)));
  out.forEach((a, i) => {
    if (a !== answers[i]) return;
    const j = out.findIndex((b, k) => k !== i && b !== answers[i] && a !== answers[k]);
    if (j >= 0) [out[i], out[j]] = [out[j], out[i]];
  });
  return out;
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
