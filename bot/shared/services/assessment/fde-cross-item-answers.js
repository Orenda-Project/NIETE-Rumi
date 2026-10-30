'use strict';
/**
 * Another item's answer printed in a stem (v37r2 G5 Maths: Q2 x began from 0.35, the answer to Q1 (b) viii «Write 35% as a
 * decimal»). A decimal, fraction or percent that ends one item's working must not be printed in a later maths stem.
 * Whole numbers are not checked (they recur in honest stems). Maths slots only; the later item is the one flagged.
 *
 * Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed}` out; never throws, never mutates.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const str = (v) => (typeof v === 'string' ? v : '');
const NON_INTEGER = /^(?:\d+\.\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?\s*%)$/;
const clean = (v) => v.replace(/\s+/g, '').replace(/^(\d+\.\d*?)0+$/, '$1');

/** The non-integer values that end a sentence of an item's worked answer. */
function answersOf(q) {
  return str(q.answer).split(/\.\s+(?=[A-Z])|\n|;/).map((sentence) => {
    const last = sentence.split('=').pop().trim().replace(/\.$/, '');
    return last.replace(/\s+[A-Za-z][\s\S]*$/, '').trim();
  }).filter((v) => NON_INTEGER.test(v)).map(clean);
}

const stemsOf = (q) => [str(q.question)].concat(Array.isArray(q.questions) ? q.questions.map((s) => str(s && s.question)) : []).join(' ');
const printed = (stem, value) => new RegExp(`(?<![\\d./]|\\d\\s)${value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/%$/, '\\s*%')}(?![\\d]|\\.\\d|\\s*/\\s*\\d)`).test(stem.replace(/(\d)\s+%/g, '$1%'));

function crossItemAnswers(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson).filter((q) => /^maths\./.test(q.slot || ''));
  const out = new Map();
  list.forEach((later, j) => {
    const stem = stemsOf(later);
    list.slice(0, j).forEach((earlier) => {
      if (earlier.slot === later.slot && earlier === later) return;
      answersOf(earlier).filter((v) => printed(stem, v)).forEach((v) => {
        const r = out.get(later.slot) || { slot: later.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
        if (!r.words.includes(v)) r.words.push(v);
        if (!r.with.includes(earlier.slot)) { r.with.push(earlier.slot); r.text.push(str(earlier.question).replace(/\s+/g, ' ').trim().slice(0, 70)); }
        out.set(later.slot, r);
      });
    });
  });
  return [...out.values()];
}

module.exports = { crossItemAnswers };
