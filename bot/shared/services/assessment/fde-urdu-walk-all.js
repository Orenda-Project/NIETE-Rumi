'use strict';
/**
 * Walk for the round 6 Urdu fixers (bd-5jmnfj.4.58.9): a copy of the paper with every item of every slot passed
 * through `fn(item, type)`, where `type` is the question type the item sits under. `eachItem` only reads.
 * A returned `undefined` keeps the item. Pure; the input is not changed.
 */

function mapAll(examJson, fn) {
  if (!examJson || typeof examJson !== 'object') return examJson;
  const out = { ...examJson };
  for (const branch of ['seen', 'unseen']) {
    const cats = examJson[branch];
    if (!cats || typeof cats !== 'object') continue;
    out[branch] = Object.fromEntries(Object.entries(cats).map(([cat, byType]) => [cat, !byType || typeof byType !== 'object' ? byType
      : Object.fromEntries(Object.entries(byType).map(([type, list]) => [type, Array.isArray(list)
        ? list.map((q) => { if (!q || typeof q !== 'object') return q; const r = fn(q, type); return r === undefined ? q : r; })
        : list]))]));
  }
  return out;
}

function eachItem(examJson, fn) {
  mapAll(examJson, (q, type) => { fn(q, type); return q; });
}

module.exports = { mapAll, eachItem };
