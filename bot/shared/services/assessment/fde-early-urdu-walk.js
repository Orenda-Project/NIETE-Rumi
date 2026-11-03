'use strict';
/**
 * Shared walk for the Grade 1-2 Urdu fixers (bd-5jmnfj.4.58): the slot types of the layout, and a copy of the
 * paper with each item of an early Urdu slot passed through `fn(item, type)`. Pure; the input is not changed.
 */

const URDU_EARLY = /^g[12]\.urdu\./;

function slotTypes(examJson) {
  const types = new Map();
  ((examJson && examJson._layout && examJson._layout.sections) || []).forEach((s) => (s.slots || []).forEach((sl) => types.set(sl.slot, sl.type)));
  return types;
}

function mapItems(examJson, fn) {
  if (!examJson || typeof examJson !== 'object') return examJson;
  const types = slotTypes(examJson);
  const out = { ...examJson };
  for (const branch of ['seen', 'unseen']) {
    const cats = examJson[branch];
    if (!cats || typeof cats !== 'object') continue;
    out[branch] = Object.fromEntries(Object.entries(cats).map(([cat, byType]) => [cat, !byType || typeof byType !== 'object' ? byType
      : Object.fromEntries(Object.entries(byType).map(([type, list]) => [type, Array.isArray(list)
        ? list.map((q) => (q && URDU_EARLY.test(String(q.slot || '')) ? fn(q, types.get(q.slot) || type) : q))
        : list]))]));
  }
  return out;
}

/** The items of one slot, in paper order. */
function itemsOf(examJson, slot) {
  const found = [];
  mapItems(examJson, (q) => { if (q.slot === slot) found.push(q); return q; });
  return found;
}

module.exports = { mapItems, slotTypes, itemsOf, URDU_EARLY };
