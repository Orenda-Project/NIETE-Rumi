'use strict';
/**
 * G5 Science marking keys whose point only restates the question (v37r4 panel, bd-5jmnfj.4.58). A point whose content words
 * all (80% or more, at least three words) already sit in the stem pays the student for copying the question back.
 * Only that is flagged: a point that adds any fact the stem does not state is left alone. Written items (Section B and C)
 * and Q2 (b) sub-questions only; Section A MCQs are not read.
 *
 * Rows ride the 'answer' shortfall path: `{slot, reason: 'answer', keyStem: true, items: ['<question> (...)']}`.
 * Pure: reads the exam JSON, never throws.
 */

const SHARE = 0.8; // of the point's content words that the stem already uses
const MIN_WORDS = 3;
const STOP = new Set('that this with from have they them then than into only when which their there because what does'.split(' '));
const words = (s) => (typeof s === 'string' ? s.toLowerCase().match(/[\p{L}]+/gu) || [] : []);
const stem = (w) => w.replace(/(ing|ed|es|s|e|ly)$/, '') || w;
const content = (s) => [...new Set(words(s).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem))];

function written(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => written(n, out));
  else if (node && typeof node === 'object') {
    if (/^science\.[BC]\./.test(node.slot || '')) {
      if (node.scheme) out.push(node);
      if (Array.isArray(node.questions)) node.questions.forEach((s) => s && s.scheme && out.push({ ...s, slot: node.slot }));
    } else if (!node.slot) Object.values(node).forEach((v) => { if (v && typeof v === 'object') written(v, out); });
  }
  return out;
}

function keyStemFlags(examJson) {
  const by = new Map();
  for (const branch of ['seen', 'unseen']) {
    for (const q of written(examJson && examJson[branch])) {
      const stemWords = content(q.question);
      const points = Array.isArray(q.scheme.points) ? q.scheme.points : [];
      for (const p of points) {
        const c = content(p && p.text);
        if (c.length < MIN_WORDS || c.filter((w) => stemWords.includes(w)).length / c.length < SHARE) continue;
        if (!by.has(q.slot)) by.set(q.slot, { slot: q.slot, reason: 'answer', keyStem: true, items: [] });
        by.get(q.slot).items.push(`${String(q.question || '').slice(0, 70)} (the point «${String(p.text).slice(0, 60)}» only restates the question)`);
      }
    }
  }
  return [...by.values()];
}

/** The re-ask paragraph for the restated-stem rows, or null when there are none. */
function keyStemNote(rows) {
  const lines = (Array.isArray(rows) ? rows : []).filter((r) => r && r.keyStem).flatMap((r) => r.items || []);
  if (!lines.length) return null;
  return `These keys restate the question as a mark: ${lines.join('; ')}. A point must state what the student has to add, never the words of the question: replace each restating point with the fact, cause or result the question asks for.`;
}

module.exports = { keyStemFlags, keyStemNote };
