'use strict';
/**
 * Shared walker for the board-checks registry (contract 8 §2).
 * Walks the G5 tree like `_walkQuestions` but also descends or[] branches, parts[] and stimulus groups,
 * skips removed:true items and joins each leaf to its `_layout.sections[].slots[]` row by `slot`.
 * Pure, never mutates its input.
 *
 * item_ref: board `<slot>#<n>`, free `<type>#<n>` (n = 1-based position of the top-level node among its
 * slot/type); suffix `/a` `/b` for OR branches, `.p<k>` for a part, `@s<k>` for the k-th member of a stimulus group.
 */

const isObj = (x) => x && typeof x === 'object';
const isGroup = (item) => !!(isObj(item) && isObj(item.stimulus) && Array.isArray(item.stimulus.items));

function eachTop(examJson, visit) {
  for (const section of ['seen', 'unseen']) {
    const branch = examJson && examJson[section];
    if (!isObj(branch)) continue;
    for (const category of Object.values(branch)) {
      if (!isObj(category)) continue;
      for (const entry of Object.values(category)) {
        const lists = Array.isArray(entry) ? [entry] : isObj(entry) ? Object.values(entry).filter(Array.isArray) : [];
        for (const list of lists) list.forEach((q) => { if (isObj(q) && q.removed !== true) visit(q); });
      }
    }
  }
}

/** slot id -> {row, sectionId} from _layout.sections[].slots[]. */
function slotIndex(examJson) {
  const map = new Map();
  const sections = examJson && examJson._layout && examJson._layout.sections;
  (Array.isArray(sections) ? sections : []).forEach((s) => {
    (Array.isArray(s && s.slots) ? s.slots : []).forEach((r) => { if (r && r.slot != null) map.set(r.slot, { row: r, sectionId: s.id }); });
  });
  return map;
}

/** Top-level nodes in tree order: [{item, slot, key, n, ref, sectionId, row}] (teacher_marked slots included). */
function topNodes(examJson) {
  const idx = slotIndex(examJson);
  const counts = new Map();
  const out = [];
  eachTop(examJson, (item) => {
    const slot = item.slot != null ? item.slot : null;
    const key = slot != null ? slot : String(item.type || '?');
    const n = (counts.get(key) || 0) + 1;
    counts.set(key, n);
    const hit = slot != null ? idx.get(slot) : null;
    out.push({ item, slot, key, n, ref: `${key}#${n}`, sectionId: hit ? hit.sectionId : undefined, row: hit ? hit.row : null });
  });
  return out;
}

function expand(item, ref, base, out) {
  if (!isObj(item) || item.removed === true) return;
  if (Array.isArray(item.or)) {
    item.or.forEach((b, i) => { const l = String.fromCharCode(97 + i); expand(b, `${ref}/${l}`, { ...base, branch: l }, out); });
  } else if (Array.isArray(item.parts)) {
    item.parts.forEach((p, k) => expand(p, `${ref}.p${k + 1}`, { ...base, part: k + 1 }, out));
  } else if (isGroup(item)) {
    item.stimulus.items.forEach((m, k) => expand(m, `${ref}@s${k + 1}`, { ...base, stimulus: item.stimulus.text }, out));
  } else {
    out.push({ item, ref, ...base });
  }
}

/** Every leaf: [{item, ref, slot, sectionId, branch?, part?, stimulus?}]; teacher_marked slots yield none. */
function leaves(examJson) {
  const out = [];
  topNodes(examJson).forEach((t) => {
    if (t.row && t.row.teacher_marked) return;
    expand(t.item, t.ref, { slot: t.slot, sectionId: t.sectionId }, out);
  });
  return out;
}

module.exports = { leaves, topNodes, slotIndex, isGroup };
