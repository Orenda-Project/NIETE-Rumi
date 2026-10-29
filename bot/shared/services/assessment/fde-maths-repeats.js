'use strict';
/**
 * Repeated calculations on a Grade 3-4 Maths paper (bd-5jmnfj.33.4, the v32 review): G3 Q2 iv orders 6 x 9,
 * 7 x 7 and 8 x 6 after Q1 ii asked 9 x 6 and Q2 ii compared 6 x 8 with 7 x 7; Q5 Task 2 (a) asks 306 x 7
 * after Q3 iii asked 305 x 7. A child who did the earlier item has done the later one.
 *
 * Two items repeat when a calculation in their stems has the same operands (a product in either order, a
 * division in the stated order), or a product whose factors are equal but for one digit of a factor of three
 * or more digits (305 x 7 and 306 x 7; table facts like 7 x 8 and 7 x 9 are different questions). The later
 * item is flagged. Only the stems are read, never the keys.
 *
 * Pure: exam JSON in, `{slot, reason:'giveaway', words, with, text, printed}` flags out, the shape
 * fde-stem-repeats gives; fde-answer-repeats merges them so the re-ask loop names them.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const MATHS = /^g[34]\.maths/;
const PRODUCT = /(\d[\d,]*)\s*[x×]\s*(\d[\d,]*)/g;
const DIVISION = [/\bdivide\s+(\d[\d,]*)\s+by\s+(\d[\d,]*)/gi, /(\d[\d,]*)\s*÷\s*(\d[\d,]*)/g];

const plain = (n) => String(n).replace(/,/g, '');
const excerpt = (q) => String(q.question || '').replace(/\s+/g, ' ').trim().slice(0, 70);

// Every calculation a stem states: {op, a, b} with plain digits, products ordered small to large (`shown` keeps the stem's order).
function calcs(question) {
  const text = String(question == null ? '' : question);
  const out = [];
  for (const m of text.matchAll(PRODUCT)) {
    const [a, b] = [plain(m[1]), plain(m[2])].sort((x, y) => Number(x) - Number(y));
    out.push({ op: 'x', a, b, shown: `${plain(m[1])} x ${plain(m[2])}` });
  }
  DIVISION.forEach((re) => { for (const m of text.matchAll(re)) out.push({ op: '÷', a: plain(m[1]), b: plain(m[2]) }); });
  return out;
}

// 305 and 306: three or more digits, one digit apart.
const nearNumber = (x, y) => x.length >= 3 && x.length === y.length && [...x].filter((c, k) => c !== y[k]).length === 1;

function sameCalc(p, q) {
  if (p.op !== q.op) return false;
  if (p.a === q.a && p.b === q.b) return true;
  if (p.op !== 'x') return false;
  const [pa, pb, qa, qb] = [p.a, p.b, q.a, q.b];
  return (pa === qa && nearNumber(pb, qb)) || (pb === qb && nearNumber(pa, qa))
    || (pa === qb && nearNumber(pb, qa)) || (pb === qa && nearNumber(pa, qb));
}

const say = (c) => c.shown || `${c.a} ${c.op} ${c.b}`;

/** The flags for each later Grade 3-4 Maths item whose stem repeats an earlier item's calculation. */
function mathsRepeats(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson).filter((q) => MATHS.test(String(q.slot || '')));
  const sums = list.map((q) => calcs(q.question));
  const out = new Map();
  list.forEach((q, j) => list.slice(0, j).forEach((earlier, i) => {
    const shared = sums[j].filter((c) => sums[i].some((e) => sameCalc(c, e)));
    if (!shared.length) return;
    const r = out.get(q.slot) || { slot: q.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
    shared.map(say).forEach((w) => { if (!r.words.includes(w)) r.words.push(w); });
    if (!r.with.includes(earlier.slot)) { r.with.push(earlier.slot); r.text.push(excerpt(earlier)); }
    out.set(q.slot, r);
  }));
  return [...out.values()];
}

module.exports = { mathsRepeats };
