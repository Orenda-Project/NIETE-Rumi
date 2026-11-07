'use strict';
/**
 * D21 mark-consistency (bd-5jmnfj.38.33 c): one number for an MCQ's mark. Compares the key legend's MCQ line
 * (variant.legend.lines_en[0], "MCQs: ½ mark ..."), the marks_each of every mcq/scenario slot of the variant, and the
 * printed `marks` of every MCQ leaf against its slot. Hard: LEGEND_MARK (legend vs a slot), SLOT_MARK (mcq/scenario slots
 * disagree), ITEM_MARK (printed mark vs its slot). Nothing to compare (no legend line or no slots) is no issue. Pure.
 */
const { leaves } = require('./walk');
const { issue } = require('./common');

const ID = 'D21';
const FRACTION = { '¼': 0.25, '½': 0.5, '¾': 0.75 };
const LIMITS = {}; // no tunable: the pattern's own numbers are compared
const OBJECTIVE = new Set(['mcq', 'scenario']);

function legendMark(variant) {
  const line = variant && variant.legend && Array.isArray(variant.legend.lines_en) ? String(variant.legend.lines_en[0] || '') : '';
  const m = /^MCQs:\s*(\d+(?:\.\d+)?|[¼½¾])/.exec(line);
  return m ? (FRACTION[m[1]] || Number(m[1])) : null;
}

function run(examJson, ctx) {
  const out = [];
  const variant = ctx && ctx.variant;
  const slots = ((variant && variant.sections) || []).flatMap((s) => s.slots || []).filter((s) => OBJECTIVE.has(s.type) && typeof s.marks_each === 'number');
  const legend = legendMark(variant);
  if (legend != null) slots.filter((s) => s.marks_each !== legend).forEach((s) => out.push(issue(ID, 'LEGEND_MARK', s.slot, `the legend gives an MCQ ${legend}, slot ${s.slot} is ${s.marks_each} each`, true, s.slot)));
  else if (new Set(slots.map((s) => s.marks_each)).size > 1) slots.slice(1).filter((s) => s.marks_each !== slots[0].marks_each).forEach((s) => out.push(issue(ID, 'SLOT_MARK', s.slot, `slot ${s.slot} is ${s.marks_each} each, slot ${slots[0].slot} is ${slots[0].marks_each}`, true, s.slot)));
  const rowMark = new Map(slots.map((s) => [s.slot, s.marks_each]));
  leaves(examJson).forEach(({ item, ref, slot }) => {
    if (!Array.isArray(item.options) || !rowMark.has(slot) || item.marks == null) return;
    if (Number(item.marks) !== rowMark.get(slot)) out.push(issue(ID, 'ITEM_MARK', ref, `printed ${item.marks}, slot ${slot} is ${rowMark.get(slot)} each`, true, slot));
  });
  return { ok: !out.some((i) => i.hard), issues: out };
}

module.exports = { id: ID, name: 'mark-consistency', hard: true, modes: ['board'], LIMITS, run, legendMark };
