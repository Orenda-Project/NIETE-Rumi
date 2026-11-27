'use strict';
/**
 * A question FDE splits across thinking levels inside itself (its slot carries `levels`, e.g. an English
 * letter worth Remember 4, Understand 3, Apply 3) has one item and so one `blooms` tag. A single tag on
 * a split question reads as wrong to any reviewer: "write an application" tagged Understand. The item
 * carries the split, and its one tag is the highest level the split gives marks to.
 *
 * The blueprint check already counts these marks by the slot's split, so the paper's level mix is
 * unchanged. Pure: exam JSON in, { examJson, notes } out. Never throws on an item it cannot read.
 */

const ORDER = ['Remember', 'Understand', 'Apply'];

const highest = (levels) => ORDER.filter((band) => Number(levels[band]) > 0).pop() || null;

function splitTags(examJson) {
  const notes = [];
  if (!examJson || typeof examJson !== 'object') return { examJson, notes };
  const sections = (examJson._layout && Array.isArray(examJson._layout.sections)) ? examJson._layout.sections : [];
  const split = new Map(sections.flatMap((s) => (s && Array.isArray(s.slots) ? s.slots : []))
    .filter((s) => s && s.levels && typeof s.levels === 'object' && highest(s.levels))
    .map((s) => [s.slot, s.levels]));
  if (!split.size) return { examJson, notes };
  const tag = (q) => {
    if (!q || typeof q !== 'object' || !split.has(q.slot)) return q;
    const levels = split.get(q.slot);
    const blooms = highest(levels);
    if (q.blooms !== blooms) notes.push({ slot: q.slot, from: q.blooms || null, to: blooms });
    return { ...q, blooms, levels: { ...levels } };
  };
  const unseen = Object.fromEntries(Object.entries(examJson.unseen || {}).map(([cat, byType]) => [cat,
    (byType && typeof byType === 'object')
      ? Object.fromEntries(Object.entries(byType).map(([type, list]) => [type, Array.isArray(list) ? list.map(tag) : list]))
      : byType]));
  return { examJson: { ...examJson, unseen }, notes };
}

module.exports = { splitTags };
