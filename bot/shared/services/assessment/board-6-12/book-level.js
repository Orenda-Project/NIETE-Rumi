'use strict';
/**
 * Round 10 (bd-5jmnfj.38.30, blind panel A4b): an item that repeats the book is Knowledge, whatever the model
 * tagged. "Repeats" = its stem carries a run of `run` consecutive book words (a book statement), or every number
 * in it (at least `minNumbers`) sits in one book worked example. Code re-tags before the checks, so the level
 * quota and blueprint see the true K count. Pure.
 * bd-qyi45h.10: "sits in" means the item's numbers, as a multiset, equal a run of consecutive numbers in the
 * example (any order), and x^2 / x² read the same. Any-number-anywhere sent 50-93% of prod G9/G10 Maths board
 * papers to K: an exponent 2 and the 0 of "= 0" are in nearly every worked example.
 * bd-qyi45h.10 r2: small numbers (0-10) alone match some run in one of ~50 worked examples by chance on a
 * whole-book paper ("log 2 + log 5" hit the Uranus-mass example), forcing ~19 new items per paper to K. So a
 * number match needs one telling number (above 10, or a decimal), or `inOrder` numbers in the example's own order.
 */
const { leavesOf } = require('./tree');

const LIMITS = { run: 8, minNumbers: 2, exampleSpan: 600, small: 10, inOrder: 5 };
const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)?/g) || [];
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
/** The numbers of a text in order; superscript digits read as digits and `^` is dropped, so x^2 and x² agree. */
const numbers = (s) => String(s || '').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => ` ${SUP[c]}`).replace(/\^/g, ' ')
  .match(/\d+(?:\.\d+)?/g) || [];
const bag = (list) => list.slice().sort().join(' ');
/** True when `nums` (as a multiset) equals some run of nums.length consecutive numbers of the example. */
const inRun = (nums, ex) => {
  const want = bag(nums);
  for (let i = 0; i + nums.length <= ex.length; i += 1) if (bag(ex.slice(i, i + nums.length)) === want) return true;
  return false;
};
const sameOrder = (nums, ex) => {
  const want = nums.join(' ');
  for (let i = 0; i + nums.length <= ex.length; i += 1) if (ex.slice(i, i + nums.length).join(' ') === want) return true;
  return false;
};
const telling = (n) => Number(n) > LIMITS.small || /\.\d*[1-9]/.test(n);

const cache = new Map();
function bookOf(text) {
  if (!cache.has(text)) {
    const w = words(text);
    const runs = new Set();
    for (let i = 0; i + LIMITS.run <= w.length; i += 1) runs.add(w.slice(i, i + LIMITS.run).join(' '));
    const examples = String(text).split(/\bexample\b/i).slice(1).map((b) => numbers(b.slice(0, LIMITS.exampleSpan)));
    if (cache.size > 8) cache.clear();
    cache.set(text, { runs, examples });
  }
  return cache.get(text);
}

function isBook(item, text) {
  if (!text || !item) return false;
  const { runs, examples } = bookOf(text);
  const w = words(item.question);
  for (let i = 0; i + LIMITS.run <= w.length; i += 1) if (runs.has(w.slice(i, i + LIMITS.run).join(' '))) return true;
  const nums = numbers(item.question);
  if (nums.length < LIMITS.minNumbers) return false;
  if (nums.some(telling)) return examples.some((ex) => inRun(nums, ex));
  return nums.length >= LIMITS.inOrder && examples.some((ex) => sameOrder(nums, ex));
}

/** Sets tag.blooms 'K' on every leaf that repeats the book; returns how many changed. */
function relevel(tree, text) {
  if (!text) return 0;
  let n = 0;
  leavesOf(tree).forEach((l) => {
    if (l && l.tag && typeof l.tag === 'object' && l.tag.blooms !== 'K' && isBook(l, text)) { l.tag.blooms = 'K'; n += 1; }
  });
  return n;
}

module.exports = { LIMITS, isBook, relevel };
