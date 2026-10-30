'use strict';
/**
 * A division point or common error names the digits the long-division method really uses
 * (bd-5jmnfj.33.3). v31 G4 Maths Q3 iv "Divide 6,375 by 15": the M point said "using the first
 * three digits to start" and the error "instead of using the first three digits 637", but 15 goes
 * into 63, the first two. Q5 iii "Divide 9,576 by 18": the error listed "9 or 95" as wrong starts,
 * and 95 is the right one.
 *
 * Pure: an item in; the same item back when nothing changes, else a rewritten copy with one note.
 */

const NUM = '\\d[\\d,]*';
const FORMS = [
  new RegExp(`\\bdivide\\s+(${NUM})\\s+by\\s+(${NUM})`, 'i'),
  new RegExp(`(${NUM})\\s*(?:÷|/)\\s*(${NUM})`),
  new RegExp(`(${NUM})\\s+divided\\s+by\\s+(${NUM})`, 'i'),
];
const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const COUNT = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const FIRST = /\bfirst\s+(one|two|three|four|five|six|seven|eight|nine|\d)\s+digits?\b(\s+\d[\d,]*)?/gi;
const INTO = /\b(divid(?:e|ing))\s+(\d[\d,]*)\s+into\s+(\d[\d,]*(?:\s+or\s+\d[\d,]*)*)/i;

const plain = (n) => String(n).replace(/,/g, '');
const tidy = (n) => String(n).replace(/,+$/, '');

/** `{a, b}` of the first "a ÷ b" the stem states, else the answer states; null when neither does. */
function divisionOf(q) {
  for (const text of [q && q.question, q && q.answer]) {
    const s = String(text == null ? '' : text);
    for (const re of FORMS) {
      const m = re.exec(s);
      if (m) return { a: tidy(m[1]), b: tidy(m[2]) };
    }
  }
  return null;
}

/** The shortest leading digits of `a` that `b` goes into, as `{count, digits}`; null when `b` exceeds `a`. */
function firstDigits(a, b) {
  const digits = plain(a);
  const divisor = Number(plain(b));
  if (!digits || !(divisor > 0)) return null;
  for (let count = 1; count <= digits.length; count += 1) {
    const lead = digits.slice(0, count);
    if (Number(lead) >= divisor) return { count, digits: lead };
  }
  return null;
}

// "first three digits 637" -> "first two digits 63"; "first three digits" -> "first two digits".
const sayFirst = (start, withDigits) => (start.count === 1 ? 'first digit' : `first ${WORDS[start.count] || start.count} digits`)
  + (withDigits ? ` ${start.digits}` : '');
const fixFirst = (text, start) => String(text).replace(FIRST, (m, n, digits) => {
  const count = COUNT[n.toLowerCase()] || Number(n);
  const same = count === start.count && (!digits || plain(digits.trim()) === start.digits);
  return same ? m : sayFirst(start, Boolean(digits));
});

// "divide 18 into 9 or 95" -> "divide 18 into 9"; an empty list blanks the error.
function fixInto(error, d, start) {
  const m = INTO.exec(error);
  if (!m || plain(m[2]) !== plain(d.b)) return error;
  const kept = m[3].split(/\s+or\s+/).filter((n) => plain(n) !== start.digits);
  if (!kept.length) return '';
  return error.slice(0, m.index) + `${m[1]} ${m[2]} into ${kept.join(' or ')}` + error.slice(m.index + m[0].length);
}

/** `{q, notes}`: the item with its division points and common error naming the digits really used first. */
function divisionSteps(q) {
  const d = divisionOf(q);
  const start = d && firstDigits(d.a, d.b);
  const s = q && q.scheme;
  if (!start || !s) return { q, notes: [] };
  let changed = false;
  const points = (Array.isArray(s.points) ? s.points : []).map((p) => {
    if (!p || typeof p.text !== 'string') return p;
    const text = fixFirst(p.text, start);
    if (text === p.text) return p;
    changed = true;
    return { ...p, text };
  });
  const scheme = { ...s, points: Array.isArray(s.points) ? points : s.points };
  if (typeof s.common_error === 'string') {
    const error = fixFirst(fixInto(s.common_error, d, start), start);
    if (error !== s.common_error) { changed = true; scheme.common_error = error; }
  }
  if (!changed) return { q, notes: [] };
  return { q: { ...q, scheme }, notes: [{ slot: q.slot, reason: 'division_steps', division: `${d.a} ÷ ${d.b}`, first: start.digits }] };
}

module.exports = { divisionOf, divisionSteps, firstDigits };
