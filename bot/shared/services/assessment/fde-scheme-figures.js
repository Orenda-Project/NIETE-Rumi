'use strict';
/**
 * The figures a board-pattern maths scheme states beside its key (bd-5jmnfj.4.55).
 *
 * mathsCheck checks the key; the model also writes sums into `accept` and a
 * slip figure into `common_error`, and gets them wrong often enough (v24 G5
 * Q2 ii accepted "541,256"; its no-regrouping slip said 659,358, not 658,742;
 * Q2 v's forgot-the-zero slip said 296,220, not 98,740). Here:
 *  - an accept entry stating a whole-number sum that is wrong is dropped;
 *  - a slip figure is recomputed when a slip model covers it: subtracting
 *    without regrouping, or forgetting the zero of a 2-digit multiplier.
 * A figure no model covers is left exactly as written. Whole numbers only.
 *
 * Pure: no I/O, never throws. `parseForm` is maths-check's, passed in.
 */

// Western grouping (541,258), Pakistani (5,41,258), or plain digits.
const INT = String.raw`(?:\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?:,\d{3})+|\d+)`;
const WHOLE_BEFORE = String.raw`(?<![\d.,])`;
const WHOLE_AFTER = String.raw`(?!\d)(?![.,]\d)`;
// "a op b = c": not a step of a longer sum (no operator before a, none after c), no remainder after c.
const SUM = new RegExp(
  String.raw`(?<![\d.,)×xX*÷/+\-−–]\s*)${WHOLE_BEFORE}(${INT})\s*([×xX*÷+\-−–])\s*(${INT})\s*=\s*(${INT})${WHOLE_AFTER}`
  + String.raw`(?!\s*(?:[×xX*÷/+\-−–(]\s*\d|r\b|rem|R\s*\d))`, 'g',
);
const SUBTRACTING = new RegExp(
  String.raw`subtract(?:ing|s)?\s+${WHOLE_BEFORE}(${INT})\s+from\s+(${INT})\s+(?:to\s+get|gives|giving|=)\s+(${INT})${WHOLE_AFTER}`, 'gi',
);
const NO_REGROUP = /without\s+regroup|smaller\s+digit\s+from\s+the\s+larger/i;
const FORGOT_ZERO = /forget\w*\s+(?:to\s+place\s+|to\s+write\s+)?the\s+zero|without\s+the\s+zero/i;
const PRODUCT = new RegExp(String.raw`${WHOLE_BEFORE}(${INT})\s*[×xX*]\s*(${INT})${WHOLE_AFTER}`);
const GIVING = new RegExp(String.raw`(\bgiving\s+(?:an?\s+answer\s+of\s+)?)${WHOLE_BEFORE}(${INT})${WHOLE_AFTER}`, 'i');

const toInt = (raw) => BigInt(raw.replace(/,/g, ''));

function apply(sign, a, b) {
  if (/[×xX*]/.test(sign)) return a * b;
  if (sign === '+') return a + b;
  if (sign === '÷') return b !== 0n && a % b === 0n ? a / b : null;
  return a - b;
}

/** False only when an entry states a whole-number sum and gets it wrong. */
function statesRightFigures(entry) {
  const text = String(entry);
  for (const m of text.matchAll(SUM)) {
    const want = apply(m[2], toInt(m[1]), toInt(m[3]));
    if (want !== null && want !== toInt(m[4])) return false;
  }
  for (const m of text.matchAll(SUBTRACTING)) {
    if (toInt(m[2]) - toInt(m[1]) !== toInt(m[3])) return false;
  }
  return true;
}

/** Each column's digits subtracted the smaller from the larger: 900,000 − 358,742 → 658,742. */
function noRegroup(a, b) {
  const x = a.toString();
  const y = b.toString().padStart(x.length, '0');
  if (y.length > x.length) return null;
  const digits = [...x].map((d, i) => Math.abs(Number(d) - Number(y[i]))).join('');
  return BigInt(digits);
}

// The figure written the way the old one was: with commas when it had them.
function writeLike(n, old) {
  const s = n.toString();
  if (!old.includes(',')) return s;
  if (/^\d{1,2}(?:,\d{2})+,\d{3}$/.test(old)) return `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${s.slice(-3)}`;
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// The slip figure a covered model gives, or null.
function slipFigure(q, error, parseForm) {
  if (NO_REGROUP.test(error)) {
    const form = typeof parseForm === 'function' ? parseForm(q.question) : null;
    if (!form || form.form !== 'subtract' || !Array.isArray(form.operands)) return null;
    const [a, b] = form.operands;
    if (a.den !== 1n || b.den !== 1n || a.num < b.num) return null;
    return noRegroup(a.num, b.num);
  }
  if (FORGOT_ZERO.test(error)) {
    const m = PRODUCT.exec(String(q.answer || '')) || PRODUCT.exec(String(q.question || ''));
    if (!m) return null;
    const b = toInt(m[2]);
    if (b < 10n || b > 99n) return null;
    return toInt(m[1]) * (b / 10n);
  }
  return null;
}

/**
 * Check one question's accept figures and slip figure in place. Returns
 * `{ dropped, rewritten }`: the accept entries removed and the slip figure
 * change (`{ from, to }`), or null.
 */
function checkSchemeFigures(q, { parseForm } = {}) {
  const result = { dropped: [], rewritten: null };
  try {
    const s = q && q.scheme;
    if (!s || typeof s !== 'object') return result;
    if (Array.isArray(s.accept)) {
      const kept = s.accept.filter((a) => statesRightFigures(a));
      result.dropped = s.accept.filter((a) => !kept.includes(a));
      s.accept = kept;
    }
    if (typeof s.common_error === 'string') {
      const at = GIVING.exec(s.common_error);
      const figure = at ? slipFigure(q, s.common_error, parseForm) : null;
      if (figure !== null && figure !== toInt(at[2])) {
        const to = writeLike(figure, at[2]);
        const start = at.index + at[1].length;
        s.common_error = s.common_error.slice(0, start) + to + s.common_error.slice(start + at[2].length);
        result.rewritten = { from: at[2], to };
      }
    }
  } catch (_) {
    // A shape nothing above expected: leave the rest as it was.
  }
  return result;
}

module.exports = { checkSchemeFigures, statesRightFigures, noRegroup };
