'use strict';
/**
 * Two science items paying the same key fact (v37 review, bd-5jmnfj.4.58). Q2 (b) (i) a and c repeated Q3 (a) 4: bacteria
 * turn milk into yoghurt, fungi break down dead matter. fde-near-repeats needs 75% of a whole answer; a mark point and a
 * model sentence share less.
 *
 * Each written item of another slot gives lines: a sentence of its answer and each mark point (a sub-question's too).
 * Two lines share a fact when they have 3 or more content words in common and those are half of the shorter line's words.
 * The later item in paper order is flagged on its own slot. Science only, English only.
 * Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed:false}` out. `printed` is false: no child
 * reads the shared words, so the flag asks for a re-ask and never fails the paper.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const MIN_SHARED = 3;
const SHARE = 0.5;
const MIN_WORDS = 4;
const ARABIC = /[؀-ۿ]/;
const STOP = new Set(('this that with from have they them then than into only when which their there because shows show explains '
  + 'explain states example answer about being would could should also each other more most some such what does very').split(' '));

const words = (s) => String(s == null ? '' : s).toLowerCase().match(/[\p{L}]+/gu) || [];
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '') || w;
const content = (s) => [...new Set(words(s).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem))];
const isMcq = (q) => Array.isArray(q.options) && q.options.length > 1;
const subs = (q) => (Array.isArray(q.questions) ? q.questions.filter((s) => s && typeof s === 'object') : []);
const points = (o) => ((o.scheme && Array.isArray(o.scheme.points)) ? o.scheme.points : []).map((p) => p && p.text);
const excerpt = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 70);
const sentences = (t) => (typeof t === 'string' ? t.split(/(?<=[.;?!])\s+/) : []);

// The key lines of an item and of each sub-question, as word lists with 4 or more content words.
function linesOf(q) {
  return [q, ...subs(q)].flatMap((o) => [...sentences(o.answer), ...points(o)])
    .filter((t) => typeof t === 'string' && !ARABIC.test(t)).map((text) => ({ text, c: content(text) })).filter((l) => l.c.length >= MIN_WORDS);
}

function shared(a, b) {
  const both = a.c.filter((w) => b.c.includes(w));
  return both.length >= MIN_SHARED && both.length >= Math.min(a.c.length, b.c.length) * SHARE ? both : null;
}

/** One flag per written science item that pays a key fact an earlier item of another slot already pays. */
function sharedKeyFacts(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson).filter((q) => /^science\./.test(q.slot || '') && !isMcq(q) && !ARABIC.test(q.question || ''));
  const out = new Map();
  list.forEach((q, i) => {
    const mine = linesOf(q);
    list.slice(0, i).filter((o) => o.slot !== q.slot).forEach((o) => {
      const hit = linesOf(o).flatMap((l) => mine.map((m) => ({ w: shared(l, m), l, m }))).filter((x) => x.w).sort((a, b) => b.w.length - a.w.length)[0];
      if (!hit) return;
      const r = out.get(q.slot) || { slot: q.slot, reason: 'giveaway', words: [], with: [], text: [], printed: false };
      hit.w.forEach((w) => { if (!r.words.includes(w)) r.words.push(w); });
      if (!r.with.includes(o.slot)) {
        r.with.push(o.slot);
        r.text.push(`${excerpt(o.question)} (pays «${excerpt(hit.l.text)}», the same key fact as «${excerpt(hit.m.text)}»)`);
      }
      out.set(q.slot, r);
    });
  });
  return [...out.values()];
}

module.exports = { sharedKeyFacts };
