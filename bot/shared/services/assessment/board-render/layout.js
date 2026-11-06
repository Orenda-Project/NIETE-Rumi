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
/**
 * The writer nests a passage's MCQs in `q.stimulus.items` and its stimulus has no id (bd-5jmnfj.38.30 round 8):
 * print them as the flat items this module has always returned, each carrying {id, kind, text} of its passage.
 * OR pairs (`q.or`) and parts (`q.parts`) stay one item; items.js / scheme-items.js print their branches.
 */
// A passage label the model wrote ("Passage 4.") is renumbered in print order: drops and rewrites leave gaps and repeats.
const LABEL = /^(\s*)(Passage|Scenario|Case|Stimulus)\s+\d+\s*([.:)])\s*/i;
function unitsOf(q, gi, k) {
  const st = q.stimulus;
  if (!st || typeof st !== 'object' || !Array.isArray(st.items)) return [q];
  const kids = st.items.filter((m) => m && typeof m === 'object' && m.removed !== true);
  if (!kids.length) return [];
  const text = typeof st.text === 'string' ? st.text.replace(LABEL, (_, sp, w, p) => `${sp}${w} ${k}${p} `) : st.text;
  const stim = { id: st.id || q.id || `${q.slot}~${gi}`, kind: st.kind || 'passage', text };
  return kids.map((m) => ({ ...m, slot: q.slot, stimulus: stim }));
}

function itemsBySlot(examJson) {
  const by = new Map();
  for (const branch of ['seen', 'unseen']) {
    const tree = examJson[branch];
    if (!tree || typeof tree !== 'object') continue;
    for (const types of Object.values(tree)) {
      if (!types || typeof types !== 'object') continue;
      for (const list of Object.values(types)) {
        if (!Array.isArray(list)) continue;
        list.forEach((q, gi) => {
          if (!q || typeof q !== 'object' || q.removed === true || !q.slot) return;
          if (!by.has(q.slot)) by.set(q.slot, []);
          const list = by.get(q.slot);
          const k = new Set(list.filter((u) => u.stimulus).map((u) => u.stimulus.id)).size + 1;
          list.push(...unitsOf(q, gi, k));
        });
      }
    }
  }
  return by;
}

/** First printed number of a slot: the start of the range its label names ("Q41-60" -> 41, "Q1 (57-80)" -> 57,
 * "Q8-Q9" -> 8); 1 when the label names no range (round 8: the board numbers across slots, not from 1 each time). */
const firstNo = (slot) => {
  const m = String((slot && slot.label) || '').match(/(\d+)\s*[-–]\s*Q?\d+\D*$/);
  return m ? Number(m[1]) : 1;
};
const slotsOf = (layout, sectionId) => layout.slots.filter((s) => s.section === sectionId);
const isRtl = (layout) => layout.rtl === true;
const langOf = (layout) => (isRtl(layout) ? 'ur' : 'en');

module.exports = { layoutOf, itemsBySlot, slotsOf, isRtl, langOf, firstNo };
