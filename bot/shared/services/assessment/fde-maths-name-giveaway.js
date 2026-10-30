'use strict';
/**
 * A term that is the keyed answer of a "name" item, printed by another maths item (v37r4 G5 Maths, bd-5jmnfj.4.58.9.1).
 * Q4 iii printed the option «Complementary angles», which is the answer Q8 asks the child to name.
 *
 * A "name" item is one whose stem asks to name / what is it called, or whose mark point reads «named X». Its keyed terms are
 * the words after «named», «called» or «are/is» ending its answer, minus the words its own stem prints and generic words
 * (angle, pair). Another maths item (stem, options, sub-question stems) that prints a term gives it away and is flagged
 * on its own slot. Terms are compared whole-word, case-insensitive. Pure: exam JSON in, flags
 * `{slot, reason:'giveaway', words, with, text, printed}` out; never throws, never mutates.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const str = (v) => (typeof v === 'string' ? v : '');
const WORD = /[a-z]+/g;
const GENERIC = new Set(['angle', 'angles', 'pair', 'pairs', 'the', 'and', 'are', 'both', 'them', 'these', 'those', 'each', 'other', 'shape', 'shapes', 'figure']);
const ASKS_NAME = /\bname\b|\bnamed\b|\bcalled\b|\bidentify\b/i;
const subs = (q) => (Array.isArray(q.questions) ? q.questions.map((s) => str(s && typeof s === 'object' ? s.question : s)) : []);
const stemOf = (q) => [str(q.question), ...subs(q)].join(' ');
const printedOf = (q) => [stemOf(q), ...(Array.isArray(q.options) ? q.options.map(str) : [])].join(' ').toLowerCase();
const wordsOf = (t) => t.toLowerCase().match(WORD) || [];

// The keyed names of an item: the tail of «named X», «called X» or «are/is X.» in its mark points and answer.
function keyedTerms(q) {
  const points = (q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : []).map((p) => str(p && p.text));
  const tails = points.map((t) => (/\b(?:named|called)\s+(.+)$/i.exec(t) || [])[1]);
  const lastSentence = str(q.answer).split(/(?<=\.)\s+/).filter(Boolean).pop() || '';
  tails.push((/\b(?:are|is|named|called)\s+(?:called\s+)?([a-z][a-z ]*?)\.?$/i.exec(lastSentence) || [])[1]);
  const own = new Set(wordsOf(stemOf(q)));
  return [...new Set(tails.filter(Boolean).flatMap(wordsOf))].filter((w) => w.length >= 5 && !GENERIC.has(w) && !own.has(w));
}

function mathsNameGiveaways(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson).filter((q) => /^maths\./.test(q.slot || ''));
  const out = new Map();
  list.filter((q) => ASKS_NAME.test(str(q.question))).forEach((asker) => {
    const terms = keyedTerms(asker);
    if (!terms.length) return;
    list.filter((other) => other !== asker).forEach((other) => {
      const shown = new Set(wordsOf(printedOf(other)));
      const hit = terms.filter((t) => shown.has(t));
      if (!hit.length) return;
      const r = out.get(other.slot) || { slot: other.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
      hit.forEach((w) => { if (!r.words.includes(w)) r.words.push(w); });
      r.with.push(asker.slot);
      r.text.push(`${str(asker.question).replace(/\s+/g, ' ').trim().slice(0, 70)} (the item «${stemOf(other).replace(/\s+/g, ' ').trim().slice(0, 50)}» prints «${hit.join(' ')}»)`);
      out.set(other.slot, r);
    });
  });
  return [...out.values()];
}

module.exports = { mathsNameGiveaways };
