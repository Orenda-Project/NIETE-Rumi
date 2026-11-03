'use strict';
/**
 * A word a Section B or C key or mark point asks for, printed by another item's stem or options (bd-5jmnfj.4.58 round 4).
 * v29 G5 Science Q1 (a) x «Burning coal and oil…» printed two of the three fuels Q3 (a) 6 asks for; vii «grass, rabbit,
 * fox» was a ready food chain for Q2 (a) ii; viii «producer» was one of its labels; iv «fungus» was Q3 (a) 4's first
 * mark point; xviii «Steel paper clip» was half of Q3 (a) 10's key; ii «blood vessels … heart» were two of the three
 * parts Q3 (a) 1 asks to name. fde-mcq-giveaway needs 4 words in common with a whole answer and never reads a one-word line.
 *
 * Each key line of a written item (a sentence of its answer, a mark point, an accept entry), minus the words of that
 * item's own stems, is a list of key terms. Another slot's item (its stem, options and sub-question stems) gives the
 * line away when it prints 2 or more of its terms, or the one term of a line that has only one. The item that prints
 * is flagged on its own slot, naming the excerpt of both. Terms are compared by their first 5 letters. English only.
 * Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const WORD = /[\p{L}\p{M}]+/gu;
const ARABIC = /[؀-ۿ]/;
const STOP = new Set(('the and for are was were not but all can its has had any one two out our may who how why use via per yes '
  + 'says say states state gives give names name writes write correct correctly because answer answers mark marks accept either example '
  + 'examples such other also called when after before which that with from this they them then than into only some will would there '
  + 'their what does more most less many much same each very whole part parts point points sub question questions about being been '
  + 'while where these those your have make makes made like use used uses using one two three four five long short word words '
  + 'shows show showing explain describe water air light body system heat object objects things thing living material materials '
  + 'changes change plant plants animal animals person people human humans food').split(' '));
const subs = (q) => (Array.isArray(q.questions) ? q.questions.filter(Boolean) : []);
const isMcq = (q) => Array.isArray(q.options) && q.options.length > 1;
const excerpt = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 70);
const root = (w) => w.slice(0, 5);
const rootsOf = (t) => [...new Set((String(t == null ? '' : t).toLowerCase().match(WORD) || []).filter((w) => w.length >= 3 && !STOP.has(w)).map(root))];
const sentences = (t) => String(t == null ? '' : t).split(/(?<=[.;?!])\s+/).filter(Boolean);
const choice = (o) => String(o == null ? '' : o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim();

const linesOf = (o) => {
  const pts = (o.scheme && Array.isArray(o.scheme.points)) ? o.scheme.points.map((p) => p && p.text) : [];
  const acc = (o.scheme && Array.isArray(o.scheme.accept)) ? o.scheme.accept : [];
  return [...sentences(o.answer), ...pts, ...acc].filter((t) => typeof t === 'string' && t.trim() && !ARABIC.test(t));
};

// What a written item keys: each line's terms that its own stems do not already say.
function keyLines(p) {
  const own = new Set(rootsOf([p.question, ...subs(p).map((s) => s.question)].join(' ')));
  return [p, ...subs(p)].flatMap(linesOf).map((line) => ({ line, terms: rootsOf(line).filter((r) => !own.has(r)) })).filter((l) => l.terms.length);
}

// A labelling item's labels: the parts of its answer after the last colon («labels: producer, primary consumer»).
function labelsOf(p) {
  if (!/\blabel/i.test(String(p.question || '')) || typeof p.answer !== 'string') return [];
  const tail = p.answer.slice(p.answer.lastIndexOf(':') + 1);
  return tail.split(/,|\band\b|;/).map((part) => rootsOf(part.replace(/\([^)]*\)/g, ''))).filter((r) => r.length && r.length <= 2);
}

/** One flag per item that prints key terms of a written item of another slot. */
function keyTermGiveaways(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson).filter((q) => /^science\./.test(q.slot || ''));
  const written = list.filter((q) => !isMcq(q) && !ARABIC.test(q.question || '')).map((p) => ({ p, lines: keyLines(p), labels: labelsOf(p) }));
  const out = new Map();
  list.forEach((q) => {
    if (ARABIC.test(q.question || '')) return;
    const printed = new Set(rootsOf([q.question, ...(Array.isArray(q.options) ? q.options.map(choice) : []), ...subs(q).map((s) => s.question)].join(' ')));
    const stemOnly = new Set(rootsOf(q.question));
    written.filter(({ p }) => p.slot !== q.slot).forEach(({ p, lines, labels }) => {
      // A label the stem itself prints is one line of one term.
      const named = labels.filter((r) => r.every((t) => stemOnly.has(t))).map((r) => ({ line: r.join(' '), terms: r }));
      const hits = lines.concat(named).map((l) => ({ l, w: l.terms.filter((t) => printed.has(t)) }))
        .filter(({ l, w }) => w.length >= 2 || (l.terms.length === 1 && w.length === 1) || (named.includes(l) && w.length === l.terms.length));
      if (!hits.length) return;
      const r = out.get(q.slot) || { slot: q.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
      const best = hits.sort((a, b) => b.w.length - a.w.length)[0];
      const shown = (best.l.line.toLowerCase().match(WORD) || []).filter((w) => best.w.includes(root(w)));
      shown.forEach((w) => { if (!r.words.includes(w)) r.words.push(w); });
      const note = `${excerpt(p.question)} (the item «${excerpt(q.question)}» prints «${[...new Set(shown)].join(' ')}»)`;
      if (!r.text.includes(note)) { r.with.push(p.slot); r.text.push(note); }
      out.set(q.slot, r);
    });
  });
  return [...out.values()];
}

module.exports = { keyTermGiveaways };
