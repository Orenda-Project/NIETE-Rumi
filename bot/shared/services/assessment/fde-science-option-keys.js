'use strict';
/**
 * G5 Science: a Section A MCQ whose keyed option IS a key point of a Section B or C item (v37r4 panel, bd-5jmnfj.4.58).
 * «Oxygen» keyed on Q1 (a) beside the Q3 (a) point «Oxygen is needed»; «iron nail» beside «The iron needle is picked up».
 * scienceGivers needs two shared words of 5 letters or more, drops words 3 or more items print, and its stemmer misses the
 * trailing e (vibrate, vibrates), so a one-word option slipped past. Here the option's content words (4 letters or more,
 * the MCQ's own stem words left out) are read against each short key point of a written item: at least half of them in one
 * point. A point is short when it is 4 words or fewer for a one-word option, 7 or fewer otherwise: a long sentence that
 * happens to carry the word is a different idea. Pure: rows `{slot, ref, question, words, with}` like scienceGivers.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const stem = (w) => w.replace(/(ing|ed|es|s|e)$/, '') || w;
const str = (v) => (typeof v === 'string' ? v : '');
const wordsOf = (s) => str(s).toLowerCase().match(/\p{L}+/gu) || [];
const cw = (s) => [...new Set(wordsOf(s).filter((w) => w.length >= 4).map(stem))];
const keyedOption = (q) => str(q.answer).replace(/^\s*\(?[a-d][).]\s*/i, '');
const subs = (q) => (Array.isArray(q.questions) ? q.questions.filter((s) => s && typeof s === 'object') : []);
const pointsOf = (o) => ((o.scheme && Array.isArray(o.scheme.points)) ? o.scheme.points.map((p) => str(p && p.text)) : []);

function keyedOptionGivers(examJson) {
  if (!examJson || typeof examJson !== 'object') return [];
  const list = itemsInOrder(examJson).filter((q) => q && typeof q === 'object');
  const written = list.filter((q) => /^science\.[BC]\./.test(str(q.slot)) && !Array.isArray(q.options));
  const found = [];
  list.filter((q) => q.slot === 'science.A.Q1a' && Array.isArray(q.options) && q.options.length > 1).forEach((m) => {
    const own = new Set(cw(m.question));
    const opt = cw(keyedOption(m)).filter((w) => !own.has(w));
    if (!opt.length) return;
    const longest = wordsOf(keyedOption(m)).length === 1 ? 4 : 7;
    const hits = new Set();
    const against = new Set();
    written.forEach((o) => [o, ...subs(o)].flatMap(pointsOf).forEach((p) => {
      if (wordsOf(p).length > longest) return;
      const said = new Set(cw(p));
      const shared = opt.filter((w) => said.has(w));
      if (shared.length && shared.length * 2 >= opt.length) { shared.forEach((w) => hits.add(w)); against.add(o.slot); }
    }));
    if (hits.size) found.push({ slot: m.slot, ref: m, question: str(m.question), words: [...hits], with: [...against] });
  });
  return found;
}

module.exports = { keyedOptionGivers };
