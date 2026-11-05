'use strict';
// MCQ option / key text helpers shared by D13 and D16 (pure). Fold = fde-mcq-key-tells.js:16.

const MARKS = /[ً-ٰٟـ]/g;
const fold = (s) => String(s == null ? '' : s).replace(MARKS, '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const URDU = ['الف', 'ب', 'ج', 'د'];
const LETTER = '(?:[A-Da-d]|الف|ب|ج|د)';
const PREFIX = new RegExp(`^\\s*(?:\\(\\s*(${LETTER})\\s*\\)|(${LETTER})\\s*[).:])\\s*`);
const toIndex = (l) => { const u = URDU.indexOf(l); return u >= 0 ? u : 'abcd'.indexOf(String(l).toLowerCase()); };

/** 0..3 for a labelled option ("A) x", "(b) x", "الف) x"), else -1. */
function labelOf(opt) {
  const m = PREFIX.exec(String(opt == null ? '' : opt));
  return m ? toIndex(m[1] || m[2]) : -1;
}
const stripLabel = (opt) => String(opt == null ? '' : opt).replace(PREFIX, '').trim();
const body = (opt) => fold(stripLabel(opt));

/** The three tries of check_paper.py:47-59. Returns the keyed option index, or -1 if not exactly one. */
function keyIndex(item) {
  const opts = Array.isArray(item && item.options) ? item.options : [];
  const raw = String(item && item.answer != null ? item.answer : '').trim();
  if (!raw || !opts.length) return -1;
  const letter = new RegExp(`^\\(?\\s*(${LETTER})\\s*(?:[).:]|$)`).exec(raw);
  if (letter) { const i = toIndex(letter[1]); return i >= 0 && i < opts.length ? i : -1; }
  const a = fold(stripLabel(raw));
  const hits = opts.map((o, i) => [body(o), i]).filter(([b]) => b && a.includes(b));
  if (hits.length === 1) return hits[0][1];
  const exact = hits.filter(([b]) => b === a);
  if (exact.length === 1) return exact[0][1];
  // "1" inside "12": keep only the hits that are not contained in another hit.
  const top = hits.filter(([b]) => !hits.some(([o]) => o !== b && o.includes(b)));
  return top.length === 1 ? top[0][1] : -1;
}

/** Number from an option/key body: integer, decimal, a/b, optional unit; else null. */
function parseNumber(text) {
  const s = String(text == null ? '' : text).trim().replace(/^(?:rs\.?|pkr)\s*/i, '');
  const m = /^(-?\d{1,3}(?:,\d{3})+|-?\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*([^\d\s][^\d]{0,13})?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2] === undefined) return n;
  const d = parseFloat(m[2]);
  return d === 0 ? null : n / d;
}

module.exports = { fold, labelOf, stripLabel, body, keyIndex, parseNumber };
