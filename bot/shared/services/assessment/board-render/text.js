'use strict';
/**
 * Text helpers for the G6-12 board renderers: HTML escaping, Urdu digits (each number its own isolated span)
 * and FBISE fractional marks. Pure, no I/O. (The FDE renderer's Latin-token isolation is design_pending here.)
 */

const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const FRACTION = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const toUrdu = (s) => s.replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]);

/** Escaped text; for an rtl paper each number becomes an isolated Urdu-digit span. */
function textOf(value, rtl) {
  const safe = esc(value);
  if (!rtl) return safe;
  return safe.replace(/[0-9]+(?:\.[0-9]+)?/g, (n) => `<span class="num">${toUrdu(n)}</span>`);
}

/** 30 -> "30", 0.5 -> "½", 1.5 -> "1½", 2.25 -> "2¼". */
function fmtMarks(n) {
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100) / 100;
  if (!frac) return String(whole);
  return `${whole || ''}${FRACTION[frac] || String(frac).slice(1)}`;
}

/** Fills the pattern atoms `{n:60}` / `{t:30}` and typesets decimal marks as fractions, then escapes. */
function marksText(line, rtl) {
  const filled = String(line == null ? '' : line)
    .replace(/\{[nt]:([0-9.]+)\}/g, (_, v) => fmtMarks(Number(v)))
    .replace(/(^|[^0-9])([0-9]+\.[0-9]+)(?![0-9])/g, (_, pre, v) => pre + fmtMarks(Number(v)));
  return textOf(filled, rtl);
}

module.exports = { esc, textOf, fmtMarks, marksText };
