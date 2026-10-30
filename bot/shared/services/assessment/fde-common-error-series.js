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

const WRITES = /(writes?\s+)(\d+(?:\s+and\s+\d+)*)/i;
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

/** For each blank: the number printed or worked out just before it. */
function previous({ nums, step }) {
  const truth = nums.slice();
  const out = [];
  truth.forEach((v, i) => {
    if (v !== null) return;
    truth[i] = (truth[i - 1] === undefined || truth[i - 1] === null ? 0 : truth[i - 1]) + step;
    out.push(truth[i - 1]);
  });
  return out;
}

function seriesError(q) {
  try {
    const error = q && q.scheme && q.scheme.common_error;
    if (typeof error !== 'string') return undefined;
    const series = parse(q.question);
    if (!series) return undefined;
    const prev = previous(series);
    const onBy = ON_BY.exec(error);
    const instead = ON_INSTEAD.test(error);
    if (!onBy && !instead) return undefined;
    if (instead && series.step > 0) return null;
    const k = instead ? Math.abs(series.step) : Number(onBy[1]);
    const wrong = prev.map((p) => p + k);
    const printed = new Set(series.nums.filter((n) => n !== null));
    if (!instead && wrong.some((w) => printed.has(w))) return null;
    const figures = wrong.join(' and ');
    const m = WRITES.exec(error);
    if (!m) return undefined;
    return m[2].replace(/\s+/g, ' ') === figures ? undefined : error.replace(WRITES, `$1${figures}`);
  } catch (e) { return undefined; }
}

module.exports = { seriesError };
