'use strict';
/**
 * bd-5jmnfj.38.31 — MCQ leaks (A5b) on a G6-12 free paper. Rewrites alone left a third of the a4 G7
 * MCQs leaking, so the writer is asked for about 30% more MCQs than the plan needs and the paper keeps
 * the subset with the fewest flagged items: greedily, the MCQ with the most problems (its own, plus
 * the times another item is flagged for overlapping it) is dropped, a tie going to the one whose key
 * letter is most common (the latest such), until the plan count is left. The targeted rewrite then
 * works on what remains. Pure: `issuesOf` is the paper check, passed in.
 */

const { items } = require('./free-secondary-checks');
const { keyIndex, isMcq } = require('./free-secondary-keys');

const POOL_SHARE = 1.3;

/** The type counts to ask the writer for: the MCQ count raised by POOL_SHARE, and how many are extra. */
function poolTypes(types) {
  const i = types.findIndex((t) => t.id === 'mcq');
  if (i < 0) return { types, extra: 0 };
  const count = Number(types[i].count) || 0;
  const asked = Math.ceil(count * POOL_SHARE);
  return { types: types.map((t, j) => (j === i ? { ...t, count: asked } : t)), extra: asked - count };
}

/** The MCQs that sit directly in a section, with the list each sits in; scenario parts are not among them. */
function sectionMcqs(examJson) {
  const out = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach((el) => {
        if (!el || typeof el !== 'object') return;
        const isItem = typeof el.question === 'string' || typeof el.answer === 'string';
        const isGroup = el.passage != null || Array.isArray(el.questions);
        if (isItem || isGroup) { if (isItem && isMcq(el)) out.push({ list: node, item: el }); } else visit(el);
      });
      return;
    }
    if (node && typeof node === 'object') Object.values(node).forEach(visit);
  };
  visit(examJson);
  return out;
}

function scores(examJson, issuesOf) {
  const numberOf = new Map(items(examJson).map((e) => [e.item, e.n]));
  const count = new Map();
  const bump = (n) => count.set(n, (count.get(n) || 0) + 1);
  issuesOf(examJson).forEach((i) => { bump(i.n); (i.avoid || []).forEach(bump); });
  return (item) => count.get(numberOf.get(item)) || 0;
}

/** Drops section MCQs until `keep` are left, the most-flagged first. Mutates the paper. */
function select(examJson, keep, issuesOf) {
  let dropped = 0;
  for (let mcqs = sectionMcqs(examJson); mcqs.length > keep; mcqs = sectionMcqs(examJson)) {
    const score = scores(examJson, issuesOf);
    const letters = new Map();
    mcqs.forEach(({ item }) => { const k = keyIndex(item); letters.set(k, (letters.get(k) || 0) + 1); });
    let worst = null;
    mcqs.forEach((m) => {
      const rank = [score(m.item), letters.get(keyIndex(m.item))];
      if (!worst || rank[0] > worst.rank[0] || (rank[0] === worst.rank[0] && rank[1] >= worst.rank[1])) worst = { ...m, rank };
    });
    worst.list.splice(worst.list.indexOf(worst.item), 1);
    dropped += 1;
  }
  return { dropped };
}

module.exports = { POOL_SHARE, poolTypes, select };
