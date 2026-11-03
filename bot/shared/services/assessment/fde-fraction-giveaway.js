'use strict';
/**
 * An MCQ that uses the fractions a later compare or order item uses (bd-5jmnfj.4.58.4). v28 G5 Maths Q1 (a) xii «Which
 * fraction is the greatest?» offered 3/4, 2/3, 3/5, 5/8 (key 3/4); Q1 (b) iii «Compare 2/3 and 3/5» and Q2 vii «Arrange 2/3,
 * 5/8 and 3/4 from the greatest to the smallest» (key 3/4 > 2/3 > 5/8) ask the child to compare the same fractions, so
 * the MCQ's key settled part of both.
 *
 * A compare item is a stem naming compare, arrange, order, greatest, largest, smallest or least with two or more
 * fractions (an MCQ's fractions are its options). Two such items of different slots sharing two or more fractions
 * give one another away: the MCQ's slot is flagged (its section is the cheapest to ask again), between two written items
 * the later one. Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const COMPARE = /\b(?:compare|arrange|order|greatest|largest|biggest|smallest|least|ascending|descending)\b/i;
const FRACTION = /(\d+)\s*\/\s*(\d+)/g;
const SHARED = 2;
const isMcq = (q) => Array.isArray(q.options) && q.options.length > 1;
const fractionsIn = (t) => [...String(t || '').matchAll(FRACTION)].map((m) => `${m[1]}/${m[2]}`);
const excerpt = (q) => String(q.question || '').replace(/\s+/g, ' ').trim().slice(0, 70);

/** The distinct fractions a compare item puts in front of the child; [] for any other item. */
function compared(q) {
  if (!COMPARE.test(String(q.question || ''))) return [];
  const all = [...new Set(fractionsIn(`${q.question} ${(q.options || []).join(' ')}`))];
  return all.length >= SHARED ? all : [];
}

function fractionGiveaways(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson);
  const sets = list.map(compared);
  const out = new Map();
  list.forEach((q, i) => list.forEach((o, j) => {
    if (j <= i || q.slot === o.slot || !sets[i].length || !sets[j].length) return;
    const same = sets[i].filter((f) => sets[j].includes(f));
    if (same.length < SHARED) return;
    const target = isMcq(q) && !isMcq(o) ? q : o;
    const partner = target === q ? o : q;
    const r = out.get(target.slot) || { slot: target.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
    same.forEach((f) => { if (!r.words.includes(f)) r.words.push(f); });
    if (!r.with.includes(partner.slot)) { r.with.push(partner.slot); r.text.push(excerpt(partner)); }
    out.set(target.slot, r);
  }));
  return [...out.values()];
}

module.exports = { fractionGiveaways };
