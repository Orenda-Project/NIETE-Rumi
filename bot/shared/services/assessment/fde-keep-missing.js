'use strict';
/**
 * A re-asked reply never loses a question the first reply had (bd-5jmnfj.4.58.9.1). v37 loop 4 G2 English: Section C,
 * re-asked whole for a Q11 pronoun key, came back without its Q16 story order and the paper failed PATTERN_SHORT_SLOT.
 *   keepMissing(fresh, kept, slots)  the fresh tree, where each listed slot it wrote fewer items for than the kept
 *                                    tree takes the kept tree's items for that slot instead.
 * Tree shape: { seen|unseen: { category: { type: [item] } } }. Pure: never throws, never mutates.
 */

const BRANCHES = ['seen', 'unseen'];

function walk(tree, fn) {
  BRANCHES.forEach((b) => Object.entries((tree && typeof tree[b] === 'object' && tree[b]) || {}).forEach(([cat, types]) => {
    if (types && typeof types === 'object') Object.entries(types).forEach(([type, list]) => { if (Array.isArray(list)) fn(b, cat, type, list); });
  }));
}

function bySlot(tree) {
  const out = new Map();
  walk(tree, (b, cat, type, list) => list.forEach((q) => {
    if (q && q.slot) (out.get(q.slot) || out.set(q.slot, []).get(q.slot)).push({ b, cat, type, q });
  }));
  return out;
}

function keepMissing(fresh, kept, slots) {
  try {
    if (!fresh || typeof fresh !== 'object') return fresh;
    const want = new Set(Array.isArray(slots) ? slots : []);
    const had = bySlot(kept);
    const got = bySlot(fresh);
    const back = [...want].filter((s) => had.has(s) && (got.get(s) || []).length < had.get(s).length);
    const out = JSON.parse(JSON.stringify(fresh));
    if (!back.length) return out;
    const drop = new Set(back);
    walk(out, (b, cat, type) => { out[b][cat][type] = out[b][cat][type].filter((q) => !(q && drop.has(q.slot))); });
    back.forEach((s) => had.get(s).forEach(({ b, cat, type, q }) => {
      out[b] = out[b] && typeof out[b] === 'object' ? out[b] : {};
      out[b][cat] = out[b][cat] && typeof out[b][cat] === 'object' ? out[b][cat] : {};
      out[b][cat][type] = (Array.isArray(out[b][cat][type]) ? out[b][cat][type] : []).concat(JSON.parse(JSON.stringify(q)));
    }));
    return out;
  } catch (e) {
    return fresh;
  }
}

module.exports = { keepMissing };
