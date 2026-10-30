'use strict';
/**
 * One concept asked too often on a paper (bd-5jmnfj.4.58.4). v28 G5 Science asked physical and chemical change five times
 * (Q1 (a) vii, Q2 (b) i c, Q2 (b) ii c, Q3 (a) 9, Q3 (b) 3) and vaccines three times (Q1 (a) viii, Q3 (a) 5, Q3 (b) 1);
 * Q3 (b) 3's stem stated Q2 (b) i c's answer and ruled out two options of Q1 (a) vii.
 *
 * A concept is asked at most twice on a paper and never by two items of one slot. An item is a multiple-choice
 * stem with its keyed option, or a written item's stem with its sub-questions' stems (a sub-question is not a second ask).
 * Every ask after the second, and a second in the slot of the first, is flagged on its own slot, naming the earlier
 * asks, so its section is asked again. Science papers only. Pure: exam JSON in, flags
 * `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { itemsInOrder, choice } = require('./fde-near-repeats');

const CONCEPTS = [
  { name: 'physical and chemical change', re: /\b(?:physical|chemical)\s+changes?\b/i },
  { name: 'vaccines', re: /\bvaccin/i },
  { name: 'transparent, translucent and opaque', re: /\b(?:transparent|translucent|opaque)\b/i },
  { name: 'conductors and insulators', re: /\b(?:conductors?|insulators?)\b/i },
];
const MOST = 2;

const isMcq = (q) => Array.isArray(q.options) && q.options.length > 1;
const askText = (q) => (isMcq(q) ? `${q.question} ${choice(q.answer)}`
  : [q.question, ...(Array.isArray(q.questions) ? q.questions.filter(Boolean).map((s) => s.question) : [])].join(' '));
const excerpt = (q) => String(q.question || '').replace(/\s+/g, ' ').trim().slice(0, 70);

function conceptRepeats(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson).filter((q) => /^science\./.test(q.slot || ''));
  const out = new Map();
  CONCEPTS.forEach(({ name, re }) => {
    const asks = list.filter((q) => re.test(askText(q)));
    asks.forEach((q, n) => {
      const before = asks.slice(0, n);
      if (n < MOST && !before.some((b) => b.slot === q.slot)) return;
      const r = out.get(q.slot) || { slot: q.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
      if (!r.words.includes(name)) r.words.push(name);
      before.forEach((b) => { if (!r.with.includes(b.slot) || !r.text.includes(excerpt(b))) { r.with.push(b.slot); r.text.push(excerpt(b)); } });
      out.set(q.slot, r);
    });
  });
  return [...out.values()];
}

module.exports = { conceptRepeats };
