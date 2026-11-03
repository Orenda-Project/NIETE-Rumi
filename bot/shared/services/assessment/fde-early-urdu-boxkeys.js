'use strict';
/**
 * Word-box fill: every keyed answer is in the box (v37r4 g2-urdu Q3 blocker: item iv keyed «فوج», box held
 * «کلیاں», which fits no blank). keyShortfall re-asks the writer; when the paper still ships with the gap, this
 * puts the missing key answer into the box in place of a box word no key uses (position kept), or appends it.
 * The box sits in `words` on the first item of the slot. Pure: {examJson, notes}; the input is not changed.
 */

const mark = (s) => String(s || '').replace(/[ً-ٰٟۖ-ۭ]/g, '').replace(/[۔،؟!:"“”«»().]/g, '').trim();

function fixSlot(items, notes) {
  const box = items.find((q) => Array.isArray(q.words) && q.words.length);
  if (!box) return items;
  const keys = items.map((q) => String(q.answer == null ? '' : q.answer).trim()).filter(Boolean);
  if (keys.length !== items.length || keys.some((k) => /\s/.test(k))) return items; // only single-word keys
  const inBox = new Set(box.words.map(mark));
  const missing = keys.filter((k) => !inBox.has(mark(k)));
  if (!missing.length) return items;
  const used = new Set(keys.map(mark));
  const words = box.words.slice();
  missing.forEach((k) => {
    const spare = words.findIndex((w) => !used.has(mark(w)));
    if (spare >= 0) {
      notes.push(`${box.slot}: box word «${words[spare]}» is no item's key; «${k}» put in its place`);
      words[spare] = k;
    } else {
      notes.push(`${box.slot}: key «${k}» was not in the box and was added`);
      words.push(k);
    }
    used.add(mark(k));
  });
  return items.map((q) => (q === box ? { ...q, words } : q));
}

function boxKeyFix(examJson) {
  const notes = [];
  if (!examJson || typeof examJson !== 'object') return { examJson, notes };
  const out = { ...examJson };
  for (const branch of ['seen', 'unseen']) {
    const cats = examJson[branch];
    if (!cats || typeof cats !== 'object') continue;
    out[branch] = Object.fromEntries(Object.entries(cats).map(([cat, byType]) => [cat, !byType || typeof byType !== 'object' ? byType
      : Object.fromEntries(Object.entries(byType).map(([type, list]) => {
        if (!Array.isArray(list)) return [type, list];
        const slots = [...new Set(list.map((q) => q && q.slot).filter(Boolean))];
        let next = list;
        slots.forEach((s) => {
          const group = next.filter((q) => q && q.slot === s);
          const fixed = fixSlot(group, notes);
          if (fixed !== group) next = next.map((q) => fixed[group.indexOf(q)] || q);
        });
        return [type, next];
      }))]));
  }
  return { examJson: out, notes };
}

module.exports = { boxKeyFix };
