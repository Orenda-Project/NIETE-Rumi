'use strict';
/** Reads a board paper's `_layout` (flat slots[], SPEC §7 / board-layout.js) and groups its items by slot. */

function layoutOf(examJson) {
  const L = examJson && examJson._layout;
  if (!L || typeof L !== 'object' || !Array.isArray(L.sections) || L.sections.length === 0 || !Array.isArray(L.slots)) {
    const err = new Error('NO_LAYOUT: this renderer only prints board-pattern papers');
    err.code = 'NO_LAYOUT';
    throw err;
  }
  return L;
}

/** slot id -> its live items in tree order. Never reads _layout, so a slot with no items has no entry. */
function itemsBySlot(examJson) {
  const by = new Map();
  for (const branch of ['seen', 'unseen']) {
    const tree = examJson[branch];
    if (!tree || typeof tree !== 'object') continue;
    for (const types of Object.values(tree)) {
      if (!types || typeof types !== 'object') continue;
      for (const list of Object.values(types)) {
        if (!Array.isArray(list)) continue;
        list.forEach((q) => {
          if (!q || typeof q !== 'object' || q.removed === true || !q.slot) return;
          if (!by.has(q.slot)) by.set(q.slot, []);
          by.get(q.slot).push(q);
        });
      }
    }
  }
  return by;
}

const slotsOf = (layout, sectionId) => layout.slots.filter((s) => s.section === sectionId);
const isRtl = (layout) => layout.rtl === true;
const langOf = (layout) => (isRtl(layout) ? 'ur' : 'en');

module.exports = { layoutOf, itemsBySlot, slotsOf, isRtl, langOf };
