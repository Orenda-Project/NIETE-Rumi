'use strict';
/**
 * The same maths skill asked twice on one G5 paper (v35 round 5, bd-5jmnfj.4.58 round 6). Q1 (a) xv «8 pencils cost Rs. 96,
 * the cost of 1 pencil» came back as Q2 x «8 pencils cost Rs. 144 ... Sara buys one pencil», Q2 x and Q2 xi were both
 * change problems, and Q1 (a) xvii (area of a triangle) was Q5 again. fde-maths-repeats counts the mean and shared key
 * numbers only; no module counted a skill across the paper.
 *
 * Each skill below is asked once, in an MCQ or a written item: a later ask (an MCQ stem, a written stem, a sub-question's
 * stem) is flagged on its own slot, naming the earlier slots. Maths only. Pure: exam JSON in, flags
 * `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const SKILLS = [
  { name: 'unit cost', re: /\bcost of (?:1|one) \w+|\b\d+\s+\w+\s+(?:cost|costs)\s+Rs\.?\s*[\d,]+/i },
  { name: 'change from a payment', re: /\bhow much change\b|\bchange (?:does|will|should|do)\b[^.?]{0,40}\b(?:get|receive|back)\b|\b(?:pays?|gives?) the (?:shopkeeper|cashier)\b/i },
  { name: 'the area of a triangle', re: /\barea of (?:a |an |the )?(?:right )?triang|\btriangular\b[^?]{0,120}\barea\b|\barea\b[^.?]{0,40}\btriang/i },
  { name: 'perimeter', re: /\bperimeter\b/i },
];

const str = (v) => (typeof v === 'string' ? v : '');
const subs = (q) => (Array.isArray(q.questions) ? q.questions.filter((s) => s && typeof s === 'object') : []);
const excerpt = (t) => str(t).replace(/\s+/g, ' ').trim().slice(0, 70);

// One ask per item, per sub-question; an MCQ's stem carries its options too (a cost in an option is still the ask).
function asksOf(q) {
  if (subs(q).length) return subs(q).map((s) => ({ slot: q.slot, stem: str(s.question) }));
  return [{ slot: q.slot, stem: str(q.question) }];
}

function mathsSkillTwice(examJson) {
  if (!examJson) return [];
  const asks = itemsInOrder(examJson).filter((q) => /^maths\./.test(q.slot || '')).flatMap(asksOf);
  const out = new Map();
  SKILLS.forEach(({ name, re }) => {
    const hits = asks.filter((a) => re.test(a.stem));
    hits.slice(1).forEach((a) => {
      const r = out.get(a.slot) || { slot: a.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
      if (!r.words.includes(name)) r.words.push(name);
      hits.slice(0, hits.indexOf(a)).forEach((b) => { r.with.push(b.slot); r.text.push(excerpt(b.stem)); });
      out.set(a.slot, r);
    });
  });
  return [...out.values()];
}

module.exports = { mathsSkillTwice };
