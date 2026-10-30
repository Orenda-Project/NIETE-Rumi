'use strict';
/**
 * Marks a teacher can award (v37 G5 Urdu Q4, bd-5jmnfj.4.58): four items worth 1.25 each printed «A1.25» in the key.
 * A slot whose every item is worth a quarter (neither whole nor half) shares its total out in half marks instead:
 * 5 over four items is 1.5, 1.5, 1, 1. A single-point item takes the item's marks; a multi-point item takes the
 * difference on its last point when that stays a half mark. Pure: a copy comes back only when something changed.
 */

const isHalf = (n) => Number.isFinite(n) && Number.isInteger(n * 2);
const isQuarter = (n) => Number.isFinite(n) && Number.isInteger(n * 4) && !isHalf(n);

function wholeMarks(examJson) {
  if (!examJson || typeof examJson !== 'object') return examJson;
  const bySlot = new Map();
  ['seen', 'unseen'].forEach((b) => Object.values(examJson[b] || {}).forEach((types) => Object.values(types || {}).forEach((l) => {
    (Array.isArray(l) ? l : []).forEach((q) => { if (q && q.slot) bySlot.set(q.slot, (bySlot.get(q.slot) || []).concat(q)); });
  })));
  const swap = new Map();
  bySlot.forEach((items) => {
    const marks = items.map((q) => Number(q.marks));
    if (!marks.some(isQuarter) || !marks.every((m) => isHalf(m) || isQuarter(m))) return;
    const total = marks.reduce((a, m) => a + m, 0);
    if (!isHalf(total)) return;
    const base = Math.floor((total / items.length) * 2) / 2;
    let extra = Math.round((total - base * items.length) * 2);
    items.forEach((q, i) => {
      const next = base + (i < extra ? 0.5 : 0);
      const delta = next - Number(q.marks);
      const pts = q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points.map((p) => ({ ...p })) : null;
      if (pts && pts.length) {
        const last = pts[pts.length - 1];
        const m = Number(last.marks) + delta;
        if (isHalf(m) && m > 0) last.marks = m;
      }
      swap.set(q, { ...q, marks: next, ...(pts ? { scheme: { ...q.scheme, points: pts } } : {}) });
    });
  });
  if (!swap.size) return examJson;
  const out = { ...examJson };
  ['seen', 'unseen'].forEach((b) => {
    if (!out[b] || typeof out[b] !== 'object') return;
    out[b] = Object.fromEntries(Object.entries(out[b]).map(([k, types]) => [k, Object.fromEntries(Object.entries(types || {}).map(([t, l]) => [t, Array.isArray(l) ? l.map((q) => swap.get(q) || q) : l]))]));
  });
  return out;
}

module.exports = { wholeMarks };
