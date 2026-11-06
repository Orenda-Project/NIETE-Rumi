'use strict';
/**
 * Round 10 (bd-5jmnfj.38.30, blind panel A4b): an item that repeats the book is Knowledge, whatever the model
 * tagged. "Repeats" = its stem carries a run of `run` consecutive book words (a book statement), or every number
 * in it (at least `minNumbers`) sits in one book worked example. Code re-tags before the checks, so the level
 * quota and blueprint see the true K count. Pure.
 */
const { leavesOf } = require('./tree');

const LIMITS = { run: 8, minNumbers: 2, exampleSpan: 600 };
const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)?/g) || [];
const numbers = (s) => new Set(String(s || '').match(/\d+(?:\.\d+)?/g) || []);

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
  return nums.size >= LIMITS.minNumbers && examples.some((ex) => [...nums].every((n) => ex.has(n)));
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
