'use strict';
/**
 * G5 Maths items that repeat or hand each other answers (bd-5jmnfj.4.58 round 4). v29 asked the mean twice (Q1 (b) ix and
 * Q7), asked 35% as a decimal twice with the same key 0.35 (Q1 (b) viii and Q2 x), and Q1 (a) iii («a right angle is 90
 * degrees») gave Q8 its first K1 while Q1 (a) ix («a straight angle is 180 degrees») gave Q4 iii its pair. fde-mcq-giveaway
 * compares words, never a number, and no module counted a topic across the paper.
 *
 * - The mean (the average is the same ask) is asked once: a later ask is flagged.
 * - A decimal of 2 or more places that a written item keys and its own stem does not print is the key of one item only:
 *   a later item with the same key number is flagged.
 * - A multiple-choice item asking how many degrees a right, straight or complete angle measures is flagged when a written
 *   item of another slot has a key line saying the same number of that angle (or of angles «adding up to» it).
 * Flags go on the later item, or the multiple-choice item, naming the earlier slots. Maths only. Pure: exam JSON in, flags
 * `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { itemsInOrder, choice } = require('./fde-near-repeats');

const isMcq = (q) => Array.isArray(q.options) && q.options.length > 1;
const str = (v) => (typeof v === 'string' ? v : '');
const excerpt = (t) => str(t).replace(/\s+/g, ' ').trim().slice(0, 70);
const subs = (q) => (Array.isArray(q.questions) ? q.questions.filter((s) => s && typeof s === 'object') : []);
const unique = (list) => [...new Set(list)];
const linesOf = (o) => [...str(o.answer).split(/(?<=[.;])\s+/), ...((o.scheme && o.scheme.points) || []).map((p) => str(p && p.text)), ...((o.scheme && o.scheme.accept) || []).map(str)];

const flag = (slot, word, earlier) => ({ slot, reason: 'giveaway', words: [word],
  with: unique(earlier.map((e) => e.slot)), text: earlier.map((e) => excerpt(e.stem)), printed: true });

// One ask per MCQ, per written item without sub-questions, per sub-question.
function asksOf(q) {
  const own = (o, stem) => ({ slot: q.slot, stem, o, mcq: isMcq(o) });
  if (subs(q).length) return subs(q).map((s) => own(s, str(s.question)));
  return [own(q, str(q.question))];
}

function meanTwice(asks) {
  const hits = asks.filter((a) => /\b(?:mean|average)\b/i.test(a.stem));
  return hits.slice(1).map((a) => flag(a.slot, 'the mean', hits.slice(0, 1)));
}

const DECIMAL = /(?<![\d.])\d+\.\d{2,}(?!\d)/g;

function sameKeyNumber(asks) {
  const written = asks.filter((a) => !a.mcq);
  const keys = written.map((a) => ({ a, nums: unique(str(a.o.answer).match(DECIMAL) || []).filter((n) => !a.stem.includes(n)) }));
  return keys.flatMap(({ a, nums }, i) => nums.flatMap((n) => {
    const before = keys.slice(0, i).filter((k) => k.nums.includes(n)).map((k) => k.a);
    return before.length ? [flag(a.slot, n, before)] : [];
  }));
}

const ANGLES = [['right', 'right'], ['straight', 'straight'], ['complete', 'complete|full']];
const SUMS = /\b(?:add(?:ing|s)? up to|sum of|together make|total of)\b/i;

function angleFacts(asks) {
  const mcqs = asks.filter((a) => a.mcq && /degrees/i.test(a.stem));
  return mcqs.flatMap((m) => {
    const name = ANGLES.find(([, re]) => new RegExp(`\\b(?:${re}) angle\\b`, 'i').test(m.stem));
    const n = (/\d+/.exec(choice(m.o.answer)) || [])[0];
    if (!name || !n) return [];
    const says = (line) => new RegExp(`\\b${n}\\b`).test(line) && /angle/i.test(line) && (new RegExp(`\\b(?:${name[1]}) angle\\b`, 'i').test(line) || SUMS.test(line));
    const given = asks.filter((a) => !a.mcq && a.slot !== m.slot && linesOf(a.o).some(says));
    return given.length ? [flag(m.slot, `${n} degrees`, given)] : [];
  });
}

function mathsRepeats(examJson) {
  if (!examJson) return [];
  const asks = itemsInOrder(examJson).filter((q) => /^maths\./.test(q.slot || '')).flatMap(asksOf);
  return [...meanTwice(asks), ...sameKeyNumber(asks), ...angleFacts(asks)];
}

module.exports = { mathsRepeats };
