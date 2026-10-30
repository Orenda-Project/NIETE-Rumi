'use strict';
/**
 * A Grade 1 Maths number-series common error that its numbers cannot give (bd-5jmnfj.4.58.4, round 4). v29:
 * «58, 57, __, 55, __» said «Counts on instead of back and writes 59 and 61» (counting on gives 58 and 56);
 * «15, 20, __, 30, __» said «Counts on by 10 and writes 30 and 40», where 30 is the number printed after the blank.
 *  - «counts on instead of back»: the figures are recomputed for a descending series, the note is dropped for an
 *    ascending one (nothing to count back);
 *  - «counts on by K»: the figures are recomputed (previous number + K); a note whose figure is already printed
 *    in the series is dropped.
 * seriesError(q) returns the corrected common_error, null to drop it, undefined to leave it. Pure; never throws.
 */

const WRITES = /(writes?\s+)(\d+(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)\d+)*)/i; // «7 and 8» or «7, 8» (v37 loop 4)
const ON_INSTEAD = /counts?\s+on\s+instead\s+of\s+(?:counting\s+)?back/i;
const ON_BY = /counts?\s+on\s+by\s+(\d+)/i;

function parse(question) {
  const cells = String(question || '').split(',').map((s) => s.trim());
  if (cells.length < 3 || !cells.every((c) => /^\d+$/.test(c) || /^_+$/.test(c))) return null;
  const nums = cells.map((c) => (/^\d+$/.test(c) ? Number(c) : null));
  let step = null;
  for (let i = 1; i < nums.length && step === null; i += 1) if (nums[i] !== null && nums[i - 1] !== null) step = nums[i] - nums[i - 1];
  return step === null || step === 0 ? null : { nums, step };
}

/** The child's answer for each blank: the number before it + k, and a blank after a blank goes on from the
 *  child's own previous answer (v37 G1 Q2: «2, 4, 6, __, __» counted on by 1 is 7, 8, never 7, 9). */
function wrongAnswers(nums, k) {
  const out = [];
  let before = null;
  nums.forEach((v, i) => {
    if (v !== null) { before = v; return; }
    before = (before === null ? 0 : before) + k;
    out.push(before);
  });
  return out;
}

function seriesError(q) {
  try {
    const error = q && q.scheme && q.scheme.common_error;
    if (typeof error !== 'string') return undefined;
    const series = parse(q.question);
    if (!series) return undefined;
    const onBy = ON_BY.exec(error);
    const instead = ON_INSTEAD.test(error);
    if (!onBy && !instead) return undefined;
    if (instead && series.step > 0) return null;
    const k = instead ? Math.abs(series.step) : Number(onBy[1]);
    const wrong = wrongAnswers(series.nums, k);
    const printed = new Set(series.nums.filter((n) => n !== null));
    if (!instead && wrong.some((w) => printed.has(w))) return null;
    const m = WRITES.exec(error);
    if (!m) return undefined;
    if (m[2].match(/\d+/g).map(Number).join() === wrong.join()) return undefined;
    return error.replace(WRITES, `$1${wrong.join(/,/.test(m[2]) ? ', ' : ' and ')}`);
  } catch (e) { return undefined; }
}

module.exports = { seriesError };
