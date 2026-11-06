'use strict';
/**
 * Rubric A6b (round 9): the levels a top-up or rewrite of `n` items for slot `s` still owes, from the slot's full
 * quota (board-checks/_level-quota) less the top nodes the tree already holds for it (an OR node by its first
 * branch). A stimulus slot, or no split, has no quota (null). Pure.
 */
const { quotaFor, leftFor } = require('../board-checks/_level-quota');
const { eachList } = require('./tree');

function owed(s, tree, levels, n) {
  if (!levels || s.stimulus) return null;
  const have = {};
  if (tree) {
    eachList(tree, (list) => list.forEach((q) => {
      if (!q || q.slot !== s.slot) return;
      const it = Array.isArray(q.or) ? q.or[0] : q;
      const b = it && it.tag && it.tag.blooms;
      if (b) have[b] = (have[b] || 0) + 1;
    }));
  }
  return leftFor(quotaFor(Number(s.generate) || 0, levels), have, n);
}

module.exports = { owed };
