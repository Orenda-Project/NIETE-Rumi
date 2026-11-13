'use strict';
/**
 * Per-slot level quota from the blueprint's cognitive split (rubric A6b). quotaFor: counts per level for a slot of
 * n items (largest remainder, ties in blueprint order). leftFor: what a rewrite of k items still owes the slot
 * (deficits first, highest level down, then the higher levels).
 * overQuota: when a level's marks-weighted share misses its target by more than tolerance_pp, the top nodes of
 * that level past their slot's quota (the last ones) as hard LEVEL_OVER issues, so extras and rewrites absorb them.
 * A target whose status is design_pending or default is report-only (tag-split reports it). Pure.
 */
const { topNodes, leaves, isGroup } = require('./walk');
const { issue } = require('./common');

const ID = 'D12';
const REPORT_ONLY = new Set(['design_pending', 'default']);

function quotaFor(n, levels) {
  const keys = Object.keys(levels || {});
  const sum = keys.reduce((a, k) => a + (Number(levels[k]) || 0), 0);
  const out = {};
  if (!sum || !(n > 0)) { keys.forEach((k) => { out[k] = 0; }); return out; }
  const raw = keys.map((k, i) => ({ k, i, x: (n * (Number(levels[k]) || 0)) / sum }));
  raw.forEach((r) => { out[r.k] = Math.floor(r.x); });
  let left = n - raw.reduce((a, r) => a + out[r.k], 0);
  raw.slice().sort((a, b) => (b.x - Math.floor(b.x)) - (a.x - Math.floor(a.x)) || a.i - b.i)
    .forEach((r) => { if (left > 0) { out[r.k] += 1; left -= 1; } });
  return out;
}

/** quota: the slot's full quota; have: live counts per level; k: items being rewritten. Fills deficits first. */
function leftFor(quota, have, k) {
  const out = {};
  const keys = Object.keys(quota);
  keys.forEach((l) => { out[l] = 0; });
  let left = k;
  // deficits are filled from the highest level down: a K-heavy paper's rewrites lean upward
  keys.slice().reverse().forEach((l) => { const d = Math.max(0, quota[l] - ((have && have[l]) || 0)); const t = Math.min(d, left); out[l] = t; left -= t; });
  // nothing owed: the surplus leans to the higher levels (last in blueprint order), the side a K-heavy paper lacks
  const up = keys.filter((l) => quota[l] > 0).reverse();
  for (let i = 0; left > 0 && up.length; i = (i + 1) % up.length) { out[up[i]] += 1; left -= 1; }
  return out;
}

const marksOf = (n) => {
  const own = Number(n.item && n.item.marks);
  if (Number.isFinite(own) && own > 0) return own;
  const each = Number(n.row && n.row.marks_each);
  return Number.isFinite(each) && each > 0 ? each : 0;
};
const levelOf = (item) => {
  const it = Array.isArray(item.or) ? item.or[0] : item;
  return (it && it.tag && it.tag.blooms) || null;
};

function share(examJson) {
  const rows = new Map(topNodes(examJson).map((t) => [t.ref, t.row]));
  const sums = {};
  let total = 0;
  leaves(examJson).forEach((l) => {
    const b = l.item && l.item.tag && l.item.tag.blooms;
    const m = marksOf({ item: l.item, row: rows.get(l.ref.replace(/[/.@].*$/, '')) });
    if (!b || !m) return;
    sums[b] = (sums[b] || 0) + m; total += m;
  });
  return total ? Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, (v / total) * 100])) : null;
}

/**
 * bd-5jmnfj.38.25.9: the marks-weighted share a paper gets when every generated slot sits exactly at its quota.
 * quotaFor counts items, not marks, and a 1-item slot's quota is always the largest level, so a pattern made of
 * single high-mark slots (FBISE Urdu/English) cannot reach its split even when every slot obeys its quota. Null
 * without layout slots.
 */
function attainable(examJson, levels) {
  const L = (examJson && examJson._layout) || {};
  const rows = Array.isArray(L.sections) ? L.sections.flatMap((s) => (Array.isArray(s.slots) ? s.slots : [])) : (Array.isArray(L.slots) ? L.slots : []);
  const sums = {};
  let total = 0;
  rows.forEach((r) => {
    if (!r || r.teacher_marked || r.project) return;
    const n = Number(r.generate != null ? r.generate : r.printed) || 0;
    const m = Number(r.marks_each) || 0;
    Object.entries(quotaFor(n, levels)).forEach(([l, c]) => { sums[l] = (sums[l] || 0) + c * m; total += c * m; });
  });
  return total ? Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, (v / total) * 100])) : null;
}

function overQuota(examJson, target) {
  if (!target || !target.levels || REPORT_ONLY.has(target.status)) return [];
  const have = share(examJson);
  if (!have) return [];
  const tol = Number.isFinite(target.tolerance_pp) ? target.tolerance_pp : 5;
  // A level the quotas themselves push past target + tol is measured from what they reach, so the tolerance still
  // applies there; every other level keeps the design target.
  const reach = attainable(examJson, target.levels) || {};
  const aim = (k) => { const t = Number(target.levels[k]) || 0; return reach[k] != null && reach[k] - t > tol + 1e-9 ? reach[k] : t; };
  const over = Object.keys(have).filter((k) => have[k] - aim(k) > tol + 1e-9);
  const out = [];
  const bySlot = new Map();
  topNodes(examJson).forEach((t) => {
    if (t.slot == null || !t.row || t.row.teacher_marked) return;
    const list = bySlot.get(t.slot) || bySlot.set(t.slot, []).get(t.slot);
    // bd-5jmnfj.38.32: each member of a stimulus group counts against the slot quota. A member over it is hard: the writer drops
    // the whole group (tree.dropIds) and the rewrite is told the levels the members still owe (slot-quota.js).
    if (isGroup(t.item)) t.item.stimulus.items.forEach((m, k) => { if (m && m.removed !== true) list.push({ ...t, item: m, member: true, ref: `${t.ref}@s${k + 1}` }); });
    else list.push(t);
  });
  over.forEach((l) => bySlot.forEach((nodes, slot) => {
    const row = nodes[0].row;
    const n = row.generate != null ? row.generate : row.printed;
    const cap = quotaFor(Number(n) || nodes.length, target.levels)[l] || 0;
    const mine = nodes.filter((t) => levelOf(t.item) === l);
    mine.slice(cap).forEach((t) => out.push(issue(ID, 'LEVEL_OVER', t.ref,
      `level ${l} is ${have[l].toFixed(1)}% of marks, target ${target.levels[l]}%${aim(l) !== (Number(target.levels[l]) || 0) ? ` (slot quotas reach ${aim(l).toFixed(1)}%)` : ''} (tolerance ${tol} pp); slot ${slot} quota ${l} ${cap}`, true, slot)));
  }));
  return out;
}

/**
 * bd-qyi45h.1 (c): one loggable line per run of the level-mix check. Per level: have (the paper's marks share),
 * target, reach (what the slot quotas reach), each to 0.1; the tolerance, the split's status and pass (no
 * LEVEL_OVER). Null without a split or a scorable item. Carries no person ids.
 */
function levelShares(examJson, target) {
  if (!target || !target.levels) return null;
  const have = share(examJson);
  if (!have) return null;
  const reach = attainable(examJson, target.levels) || {};
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  const levels = {};
  Object.keys(target.levels).forEach((k) => { levels[k] = { have: r1(have[k] || 0), target: Number(target.levels[k]) || 0, reach: r1(reach[k]) }; });
  const tol = Number.isFinite(target.tolerance_pp) ? target.tolerance_pp : 5;
  return { levels, tolerance_pp: tol, status: target.status || null, pass: !overQuota(examJson, target).length };
}

module.exports = { quotaFor, leftFor, overQuota, attainable, levelShares };
