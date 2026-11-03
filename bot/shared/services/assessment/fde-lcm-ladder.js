'use strict';
/**
 * The L.C.M. division ladder in a key (bd-5jmnfj.4.58.2). v26 G5 Maths Q2 vi printed
 * "Divide 24 and 36 by 2, 2, 3 to reach 1 and 3"; the divisors leave 2 and 3. The printed
 * pair is recomputed from the divisors the model named, so its chosen method is kept and
 * only the wrong numbers change. Pure: no I/O, never throws.
 */

const LADDER = /(Divide\s+)(\d+)(\s+and\s+)(\d+)(\s+by\s+)((?:\d+\s*(?:,|and)\s*)*\d+)(\s+to\s+reach\s+)(\d+)(\s+and\s+)(\d+)/i;

// The pair left after the divisors are applied in order; null when one divides neither number.
function remaining(a, b, divisors) {
  let x = a;
  let y = b;
  for (const d of divisors) {
    if (!(d > 1) || (x % d && y % d)) return null;
    if (!(x % d)) x /= d;
    if (!(y % d)) y /= d;
  }
  return [x, y];
}

// Returns the answer text with the "to reach" pair corrected, or the text as it came.
function fixLcmLadder(answer) {
  try {
    if (typeof answer !== 'string') return answer;
    const m = LADDER.exec(answer);
    if (!m) return answer;
    const left = remaining(Number(m[2]), Number(m[4]), m[6].split(/\s*(?:,|and)\s*/).map(Number));
    if (!left || (left[0] === Number(m[8]) && left[1] === Number(m[10]))) return answer;
    const start = m.index + m[1].length + m[2].length + m[3].length + m[4].length + m[5].length + m[6].length + m[7].length;
    return answer.slice(0, start) + left[0] + m[9] + left[1] + answer.slice(start + m[8].length + m[9].length + m[10].length);
  } catch (_) {
    return answer;
  }
}

module.exports = { fixLcmLadder, remaining };
