'use strict';
/**
 * A G2 Maths common-error note that diagnoses a slip the item's numbers cannot give or prints the wrong
 * figure for it (bd-5jmnfj.4.58.4). v28: 703 - 248 said "giving 565" (taking the smaller digit from the larger
 * in each place gives 545); 640 - 275 said "giving 475" (435); 78 - 35 named a slip that needs a column to
 * regroup and none does.
 *  - subtraction note naming the smaller-from-larger / no-borrowing slip: no column regroups, the note is
 *    dropped; otherwise the figure it gives (the last "giving/writing N") is recomputed per column.
 *  - addition note naming the no-carry slip: no column carries, the note is dropped (the figure for an
 *    addition that does carry is checked by fde-common-error-check.js).
 * Whole numbers only; anything else is returned as it was. Pure: {examJson, notes}; never throws.
 */

const MINUS = /(?<![\d.,])(\d+)\s*[-−]\s*(\d+)(?![\d.,]\d)/;
const PLUS = /(?<![\d.,])(\d+)\s*\+\s*(\d+)(?![\d.,]\d)/;
const SMALLER = /\bsmaller\s+(?:digit\s+)?(?:from|of|than)\s+(?:the\s+)?(?:larger|bigger)|\b(?:larger|bigger)\s+(?:digit\s+)?from\s+(?:the\s+)?smaller|\bwrong way round\b|\b(?:not|without|instead of)\s+(?:regroup|borrow)\w*|\bforg[eo]t\w*\s+to\s+(?:regroup|borrow)/i;
const NO_CARRY = /\b(?:not|without|no)\s+carry|\bforg[eo]t\w*\s+(?:to\s+)?carry/i;
const FIGURE = /\b(giving|gives|getting|writing|writes?)\s+(?:an\s+answer\s+of\s+)?(\d+)\b(?!\s*[-−])/gi;

const digits = (s) => [...String(s)].reverse().map(Number);

function operands(q, re) {
  const at = re.exec(String(q.answer ?? '')) || re.exec(String(q.question ?? ''));
  return at ? [at[1], at[2]] : null;
}

/** Each column's smaller digit taken from the larger, no regrouping; plus whether any column would regroup. */
function subtractionSlip(a, b) {
  const da = digits(a);
  const db = digits(b);
  if (Number(a) < Number(b)) return null;
  let slip = 0;
  let regroups = false;
  for (let i = 0; i < Math.max(da.length, db.length); i += 1) {
    const x = da[i] || 0;
    const y = db[i] || 0;
    if (x < y) regroups = true;
    slip += Math.abs(x - y) * 10 ** i;
  }
  return { slip, regroups };
}

function carries(a, b) {
  const da = digits(a);
  const db = digits(b);
  let carry = 0;
  for (let i = 0; i < Math.max(da.length, db.length) - 1; i += 1) {
    carry = Math.floor(((da[i] || 0) + (db[i] || 0) + carry) / 10);
    if (carry) return true;
  }
  return false;
}

function lastFigure(text) {
  let last = null;
  for (const m of text.matchAll(FIGURE)) last = m;
  return last;
}

/** The corrected common_error, null to drop it, undefined to leave it. */
function review(q) {
  const error = q.scheme.common_error;
  if (SMALLER.test(error)) {
    const ab = operands(q, MINUS);
    const r = ab && subtractionSlip(...ab);
    if (!r) return undefined;
    if (!r.regroups) return null;
    const fig = lastFigure(error);
    if (!fig || Number(fig[2]) === r.slip) return undefined;
    const start = fig.index + fig[0].length - fig[2].length;
    return error.slice(0, start) + r.slip + error.slice(start + fig[2].length);
  }
  if (NO_CARRY.test(error)) {
    const ab = operands(q, PLUS);
    if (ab && !carries(...ab)) return null;
  }
  return undefined;
}

function fix(q, notes) {
  if (!q || typeof q !== 'object' || !q.scheme || typeof q.scheme.common_error !== 'string') return q;
  let out;
  try { out = review(q); } catch (e) { return q; }
  if (out === undefined || out === q.scheme.common_error) return q;
  const scheme = { ...q.scheme };
  if (out === null) delete scheme.common_error; else scheme.common_error = out;
  notes.push(`${q.slot}: «${q.question}» common error «${q.scheme.common_error}» ${out === null ? 'dropped (no column can give that slip)' : `→ «${out}»`}`);
  return { ...q, scheme };
}

function commonErrorNumbers(examJson) {
  const notes = [];
  if (!examJson || typeof examJson !== 'object') return { examJson, notes };
  const out = { ...examJson };
  for (const branch of ['seen', 'unseen']) {
    const cats = examJson[branch];
    if (!cats || typeof cats !== 'object') continue;
    out[branch] = Object.fromEntries(Object.entries(cats).map(([cat, byType]) => [cat, !byType || typeof byType !== 'object' ? byType
      : Object.fromEntries(Object.entries(byType).map(([type, list]) => [type, Array.isArray(list) ? list.map((q) => fix(q, notes)) : list]))]));
  }
  return { examJson: out, notes };
}

module.exports = { commonErrorNumbers };
