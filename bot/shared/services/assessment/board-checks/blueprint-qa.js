'use strict';
/**
 * D12 blueprint-qa (contract 8 §4): the paper's arithmetic against the layout and the variant.
 * Marks are compared in quarter-marks. All issues hard except an OR pair whose blooms differ (soft).
 * ctx.P is not read: the layout slot rows already carry the pattern's printed/generate/marks_each.
 */
const { topNodes, isGroup } = require('./walk');
const { q, issue } = require('./common');

const LIMITS = {
  // design_pending: SPEC §8 says "±0 for notified subjects" and names no tolerance for the others; 0 everywhere.
  mcqShareTolerance: 0,
};
const ID = 'D12';
const OBJECTIVE = new Set(['mcq', 'scenario']);
const slotMarks = (r) => (Number(r.attempt) || 0) * q(r.marks_each);
const generateOf = (r) => (r.generate != null ? r.generate : r.printed);

function nodeCount(item) {
  if (isGroup(item)) return item.stimulus.items.filter((m) => m && m.removed !== true).length;
  return 1;
}

function sectionChecks(layout, variant, out) {
  const sections = Array.isArray(layout.sections) ? layout.sections : [];
  let sum = 0;
  let timeSum = 0; let timed = false;
  sections.forEach((s) => {
    const slots = Array.isArray(s.slots) ? s.slots : [];
    const got = slots.reduce((a, r) => a + slotMarks(r), 0);
    sum += q(s.marks);
    if (s.marks != null && got !== q(s.marks)) out.push(issue(ID, 'SECTION_MARKS', s.id, `section ${s.id} declares ${s.marks}, its slots add up to ${got / 4}`, true, s.id));
    if (s.time_min != null) { timeSum += Number(s.time_min); timed = true; }
    if (Array.isArray(s.parts) && s.time_min != null) {
      const pt = s.parts.reduce((a, p) => a + (Number(p && p.time_min) || 0), 0);
      if (s.parts.some((p) => p && p.time_min != null) && pt !== Number(s.time_min)) out.push(issue(ID, 'TIME', s.id, `section ${s.id} parts add up to ${pt} min, section says ${s.time_min}`, true, s.id));
    }
  });
  const total = q(layout.total_marks);
  if (layout.total_marks != null && sum !== total) out.push(issue(ID, 'TOTAL', '_layout', `sections add up to ${sum / 4}, _layout.total_marks is ${layout.total_marks}`, true));
  if (variant && variant.total_marks != null && sum !== q(variant.total_marks)) out.push(issue(ID, 'TOTAL', '_layout', `sections add up to ${sum / 4}, variant total_marks is ${variant.total_marks}`, true));
  if (variant && variant.total_time_min != null && timed) {
    const all = timeSum + (Number(variant.shared_time_min) || 0);
    if (all !== Number(variant.total_time_min)) out.push(issue(ID, 'TIME', '_layout', `section times plus shared time make ${all} min, variant total is ${variant.total_time_min}`, true));
  }
  return sum;
}

function variantShare(variant) {
  const secs = variant && Array.isArray(variant.sections) ? variant.sections : [];
  let mcq = 0; let all = 0; let seen = false;
  secs.forEach((s) => (Array.isArray(s.slots) ? s.slots : []).forEach((r) => {
    seen = true; const m = slotMarks(r); all += m; if (OBJECTIVE.has(r.type)) mcq += m;
  }));
  return seen && all > 0 ? { mcq, all } : null;
}

function run(examJson, ctx) {
  const out = [];
  const layout = examJson && examJson._layout;
  if (!layout) return { ok: true, issues: out };
  const variant = ctx && ctx.variant;
  const sum = sectionChecks(layout, variant, out);

  // MCQ share: cross-multiplied so no division drift; tolerance in percentage points.
  const vs = variantShare(variant);
  if (vs && sum > 0) {
    let mine = 0;
    (layout.sections || []).forEach((s) => (s.slots || []).forEach((r) => { if (OBJECTIVE.has(r.type)) mine += slotMarks(r); }));
    const diffPp = Math.abs((mine / sum) - (vs.mcq / vs.all)) * 100;
    if (diffPp > LIMITS.mcqShareTolerance + 1e-9) out.push(issue(ID, 'MCQ_SHARE', '_layout', `objective marks are ${(mine / sum * 100).toFixed(1)}% of the paper, the variant says ${(vs.mcq / vs.all * 100).toFixed(1)}%`, true));
  }

  const nodes = topNodes(examJson);
  const bySlot = new Map();
  nodes.forEach((n) => { if (n.slot != null) { (bySlot.get(n.slot) || bySlot.set(n.slot, []).get(n.slot)).push(n); } });
  (layout.sections || []).forEach((s) => (s.slots || []).forEach((r) => {
    const mine = bySlot.get(r.slot) || [];
    const live = mine.reduce((a, n) => a + nodeCount(n.item), 0);
    const gen = generateOf(r);
    if (r.teacher_marked) {
      if (mine.length) out.push(issue(ID, 'SLOT_COUNT', r.slot, `teacher_marked slot ${r.slot} carries ${mine.length} item(s)`, true, r.slot));
      return;
    }
    if (r.attempt != null && r.printed != null && Number(r.attempt) > Number(r.printed)) out.push(issue(ID, 'N_OF_M', r.slot, `attempt ${r.attempt} is more than printed ${r.printed}`, true, r.slot));
    if (r.generate != null && r.printed != null && Number(r.generate) !== Number(r.printed)) out.push(issue(ID, 'N_OF_M', r.slot, `generate ${r.generate} is not the printed ${r.printed}`, true, r.slot));
    if (gen != null && live !== Number(gen)) out.push(issue(ID, 'SLOT_COUNT', r.slot, `${live} item(s) in the slot, ${gen} expected`, true, r.slot));

    if (r.or) {
      mine.forEach((n) => {
        const b = n.item.or;
        if (!Array.isArray(b) || b.length !== 2) { out.push(issue(ID, 'OR', n.ref, 'OR slot item is not an OR node with exactly 2 branches', true, r.slot)); return; }
        if (q(b[0].marks) !== q(b[1].marks)) out.push(issue(ID, 'OR', n.ref, `OR branches carry ${b[0].marks} and ${b[1].marks} marks`, true, r.slot));
        const l = (x) => x && x.tag && x.tag.blooms;
        if (l(b[0]) !== l(b[1])) out.push(issue(ID, 'OR', n.ref, `OR branches differ in level (${l(b[0])} vs ${l(b[1])})`, false, r.slot));
      });
    }
    if (r.stimulus) {
      const groups = mine.filter((n) => isGroup(n.item));
      if (r.stimulus.count != null && groups.length !== Number(r.stimulus.count)) out.push(issue(ID, 'STIMULUS', r.slot, `${groups.length} stimulus group(s), ${r.stimulus.count} expected`, true, r.slot));
      groups.forEach((n) => {
        const k = nodeCount(n.item);
        if (r.stimulus.mcqs_per_stimulus != null && k !== Number(r.stimulus.mcqs_per_stimulus)) out.push(issue(ID, 'STIMULUS', n.ref, `group has ${k} MCQs, ${r.stimulus.mcqs_per_stimulus} expected`, true, r.slot));
        if (!String(n.item.stimulus.text || '').trim()) out.push(issue(ID, 'STIMULUS', n.ref, 'stimulus text is empty', true, r.slot));
      });
    }
  }));
  return { ok: !out.some((i) => i.hard), issues: out };
}

module.exports = { id: ID, name: 'blueprint-qa', hard: true, modes: ['board'], LIMITS, run };
