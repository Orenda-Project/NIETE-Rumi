'use strict';
/**
 * bd-5jmnfj.33.5.3 — v36 G3 General Knowledge Q2 printed a match-the-columns item whose Column A word «رکیں»
 * sat in two rows, with two Column B meanings that both fit either row, so a correct match could score 0.
 * No check looked at distinctness across the rows of one match item.
 *
 * Flags a match slot whose rows repeat a Column A entry or a Column B entry. Rows are read as the renderer
 * prints them (`matchStem`, `matchAnswer`); comparison trims and strips Urdu diacritics and Latin case.
 * Grade 3-4 only (`P.g5_rules === false`). Pure: exam JSON in; `{slot, reason:'match_rows', why, line, text}` out.
 */

const { itemsInOrder } = require('./fde-near-repeats');
const { matchStem, matchAnswer } = require('./fde-match-block');

const MARKS = /[ً-ٰٟ]/g;
const norm = (s) => String(s == null ? '' : s).normalize('NFC').replace(MARKS, '').replace(/[\s​-‏]+/g, ' ').trim().toLowerCase();
const isRow = (q) => q && typeof q === 'object';
const isMatch = (q) => isRow(q) && (/\.match$/.test(String(q.slot || '')) || Array.isArray(q.column_a));

function safe(fn, q) {
  try { return String(fn(q) ?? '').trim(); } catch (e) { return ''; }
}

// Column B exactly as the renderer prints it: the check and the renderer must see the same string.
const colB = (q) => safe(matchAnswer, q);

const LEAK_WHY = 'column A text printed in column B (pair leak)';

/** Rows whose printed Column B holds the row's own Column A text, as `{a, b, row}`. */
function leakedRows(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((r, i) => {
    const q = isRow(r) ? r : {};
    const a = safe(matchStem, q);
    const b = colB(q);
    if (norm(a) && norm(b).includes(norm(a))) out.push({ a, b, row: i });
  });
  return out;
}

function repeats(cells, why) {
  const seen = new Map();
  cells.forEach((c, i) => {
    const k = norm(c);
    if (!k) return;
    const e = seen.get(k) || { why, text: c, rows: [] };
    e.rows.push(i);
    seen.set(k, e);
  });
  return [...seen.values()].filter((e) => e.rows.length > 1);
}

/** Repeated Column A / Column B entries across the rows of one match item, as `{why, text, rows}`. */
function distinctMatchRows(rows) {
  const list = (Array.isArray(rows) ? rows : []).map((q) => (isRow(q) ? q : {}));
  return [
    ...repeats(list.map((q) => safe(matchStem, q)), 'dup_a'),
    ...repeats(list.map((q) => colB(q)), 'dup_b'),
  ];
}

/** Flags for each match slot that repeats a Column A or Column B entry. */
function matchRowsShortfall(examJson, P) {
  if (!examJson || !P || P.g5_rules !== false) return [];
  let items;
  try { items = itemsInOrder(examJson).filter(isMatch); } catch (e) { return []; }
  const bySlot = new Map();
  items.forEach((q) => bySlot.set(q.slot, [...(bySlot.get(q.slot) || []), q]));
  const out = [];
  bySlot.forEach((rows, slot) => {
    const found = distinctMatchRows(rows);
    const leaks = leakedRows(rows);
    if (!found.length && !leaks.length) return;
    const why = [...new Set([...found.map((f) => f.why), ...(leaks.length ? [LEAK_WHY] : [])])];
    const leakLines = leaks.map((l) => `Column B «${l.b}» prints the Column A text «${l.a}» in row ${l.row + 1}`);
    out.push({
      slot,
      reason: 'match_rows',
      why,
      leaks,
      line: [...found.map((f) => `${f.why === 'dup_a' ? 'Column A' : 'Column B'} «${f.text}» in rows ${f.rows.map((r) => r + 1).join(' and ')}`), ...leakLines].join('; '),
      text: [...found.map((f) => f.text), ...leaks.map((l) => l.a)],
    });
  });
  return out;
}

/** The re-ask note for the match_rows flags in `shortfall`, or '' when there are none. */
function matchRowsNote(shortfall) {
  const flags = (Array.isArray(shortfall) ? shortfall : []).filter((f) => f && f.reason === 'match_rows');
  if (!flags.length) return '';
  const lines = flags.filter((f) => (Array.isArray(f.why) ? f.why : [f.why]).some((w) => w !== LEAK_WHY)).map((f) => `Match item ${f.slot || ''}: ${f.line || (Array.isArray(f.text) ? f.text.join(', ') : '')}.`);
  const leaks = flags.flatMap((f) => (Array.isArray(f.leaks) ? f.leaks : []))
    .map((l) => `Column B holds its own Column A text «${l.a}» in row ${l.row + 1}; Column B must hold only the right-hand word.`);
  const dup = flags.some((f) => (Array.isArray(f.why) ? f.why : []).some((w) => w !== LEAK_WHY));
  const tail = dup ? ' Rewrite the match item so every Column A entry and every Column B entry appears once, '
    + 'and each Column B meaning fits exactly one Column A word.' : '';
  return [lines.join(' '), ...leaks, tail.trim()].filter(Boolean).join(' ');
}

module.exports = { distinctMatchRows, matchRowsShortfall, matchRowsNote };
