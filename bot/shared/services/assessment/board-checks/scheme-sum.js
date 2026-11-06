'use strict';
/**
 * D14 scheme-sum (contract 8 §6): a constructed item's marking scheme adds up to its marks.
 * Style = ctx.variant.scheme_style. analytic_points: POINTS_SUM, NO_POINTS. holistic_bands: BAND_TOP, BAND_GAP.
 * OR branches and parts are checked separately; part marks must add up to the parent. All hard.
 */
const { topNodes, isGroup } = require('./walk');
const { q, issue } = require('./common');

const LIMITS = {
  bandStep: 1, // design_pending: whole-mark bands (8-7, 6-4, 3-0); no source for fractional bands
};
const ID = 'D14';
const CONSTRUCTED = new Set(['srq', 'erq']);

// design_pending: band field names {lo, hi, descriptor} are proposed; c-patterns' scheme contract confirms them.
// This accessor is the only place the names appear.
const bandsOf = (item) => (item.scheme && Array.isArray(item.scheme.bands) ? item.scheme.bands.map((b) => ({ hi: b.hi, lo: b.lo })) : []);
const pointsOf = (item) => (item.scheme && Array.isArray(item.scheme.points) ? item.scheme.points : []);
const isConstructed = (item) => !Array.isArray(item.options) && (CONSTRUCTED.has(item.type) || (item.scheme != null && item.type == null));

function checkLeaf(item, ref, slot, style, out) {
  const push = (rule, msg) => out.push(issue(ID, rule, ref, msg, true, slot));
  const marks = q(item.marks);
  if (style === 'analytic_points') {
    const pts = pointsOf(item);
    if (!pts.length) { push('NO_POINTS', 'constructed item has no scheme points'); return; }
    const sum = pts.reduce((a, p) => a + q(p && p.marks), 0);
    if (sum !== marks) push('POINTS_SUM', `scheme points add up to ${sum / 4}, item carries ${item.marks}`);
    return;
  }
  const bands = bandsOf(item);
  if (!bands.length) { push('BAND_TOP', 'constructed item has no bands'); return; }
  if (q(bands[0].hi) !== marks) push('BAND_TOP', `top band reaches ${bands[0].hi}, item carries ${item.marks}`);
  const step = q(LIMITS.bandStep);
  for (let i = 1; i < bands.length; i += 1) {
    if (q(bands[i].hi) !== q(bands[i - 1].lo) - step) { push('BAND_GAP', `band ${i} tops at ${bands[i].hi} after a band ending at ${bands[i - 1].lo}`); return; }
  }
  if (q(bands[bands.length - 1].lo) !== 0) push('BAND_GAP', `lowest band stops at ${bands[bands.length - 1].lo}, not 0`);
}

function walk(item, ref, slot, style, out) {
  if (!item || item.removed === true) return;
  if (Array.isArray(item.or)) {
    item.or.forEach((b, i) => walk(b, `${ref}/${String.fromCharCode(97 + i)}`, slot, style, out));
  } else if (Array.isArray(item.parts)) {
    const live = item.parts.filter((p) => p && p.removed !== true);
    if (item.marks != null) {
      const sum = live.reduce((a, p) => a + q(p.marks), 0);
      if (sum !== q(item.marks)) out.push(issue(ID, 'POINTS_SUM', ref, `part marks add up to ${sum / 4}, parent carries ${item.marks}`, true, slot));
    }
    item.parts.forEach((p, k) => walk(p, `${ref}.p${k + 1}`, slot, style, out));
  } else if (isGroup(item)) {
    // stimulus members are objective; nothing to sum
  } else if (isConstructed(item)) {
    checkLeaf(item, ref, slot, style, out);
  }
}

function run(examJson, ctx) {
  const out = [];
  const style = ctx && ctx.variant && ctx.variant.scheme_style;
  if (style !== 'analytic_points' && style !== 'holistic_bands') return { ok: true, issues: out };
  topNodes(examJson).forEach((n) => {
    if (n.row && n.row.teacher_marked) return;
    walk(n.item, n.ref, n.slot == null ? undefined : n.slot, style, out);
  });
  return { ok: !out.some((i) => i.hard), issues: out };
}

module.exports = { id: ID, name: 'scheme-sum', hard: true, modes: ['board'], LIMITS, run };
