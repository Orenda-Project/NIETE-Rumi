'use strict';
/**
 * The values and the user message for one eg.task.board_section call (prompts contract §4). Pure.
 * Placeholders left to the cell (grade, age, exam_name, variant_label, level_*, tolerance_pp, slo_list) are filled here
 * too, because prompts-6-12.assemble fills every part of the system string from one `values` object.
 */
const { levelValues } = require('../prompts-6-12');
const { slotLine } = require('./slot-lines');
const { unitMarks } = require('./units');
const { leavesOf } = require('./tree');

const NOT_SET = 'not set';
const STEM_CUT = 60;
const STEM_KEEP = 40;

const stemOf = (l) => String(l.question || l.main_question || '').slice(0, STEM_CUT);

function earlierStems(trees) {
  const stems = trees.flatMap((t) => leavesOf(t).map(stemOf)).filter(Boolean);
  return stems.length ? stems.slice(-STEM_KEEP).join('; ') : 'none yet';
}

/** Marks written so far per level letter (tag.blooms); a leaf with no marks takes its slot's marks_each. */
function levelTally(trees, slots) {
  const each = new Map(slots.map((s) => [s.slot, s.marks_each]));
  const out = {};
  trees.forEach((t) => leavesOf(t).forEach((l) => {
    if (!l.tag || !l.tag.blooms) return;
    const m = l.marks != null ? Number(l.marks) : Number(each.get(l.slot)) || 0;
    out[l.tag.blooms] = (out[l.tag.blooms] || 0) + m;
  }));
  return out;
}

const render = (obj, sep) => Object.keys(obj).map((k) => `${k} ${obj[k]}`).join(sep);

function levelPart(variant, row) {
  const split = variant.cognitive_split && variant.cognitive_split.levels ? variant.cognitive_split : row && row.tos_default;
  return split && split.levels ? split : null;
}

function promptValues({ grade, row, P, variant, unit, done, slotsAll, sloList }) {
  const all = slotsAll || (variant.sections || []).flatMap((s) => s.slots);
  const split = levelPart(variant, row);
  const lv = split ? levelValues(split) : null;
  const tally = levelTally(done, all);
  const total = Number(variant.generated_marks != null ? variant.generated_marks : variant.total_marks);
  let remaining = NOT_SET;
  if (split) {
    const left = {};
    Object.keys(split.levels).forEach((k) => { left[k] = Math.max(0, (split.levels[k] * total) / 100 - (tally[k] || 0)); });
    remaining = render(left, ' / ');
  }
  const header = variant.exam_header && variant.exam_header.lines_en;
  return {
    grade,
    age: `${Number(grade) + 5} to ${Number(grade) + 6}`,
    slo_list: sloList || 'none loaded',
    exam_name: header ? header.slice(0, 2).join(' · ') : P.name_en,
    variant_label: variant.label_en || variant.label_ur || variant.variant_id,
    level_scale: lv ? lv.level_scale : NOT_SET,
    level_legend: lv ? lv.level_legend : NOT_SET,
    level_split: lv ? lv.level_split : NOT_SET,
    tolerance_pp: lv ? lv.tolerance_pp : NOT_SET,
    section_key: unit.key,
    section_title: unit.title,
    section_marks: unitMarks(unit.slots),
    time_line: unit.time_min ? `, ${unit.time_min} minutes` : '',
    slot_lines: unit.slots.map(slotLine).join('\n'),
    earlier_stems_short: earlierStems(done),
    level_tally: Object.keys(tally).length ? render(tally, ', ') : 'none yet',
    split_remaining: remaining,
  };
}

function userPrompt({ content, pageReference, note }) {
  const head = `Write the section named in the task from this book text.\nPages: ${pageReference || 'whole selection'}\n\n**Book Text Content:**\n\`\`\`\n${content}\n\`\`\`\n\nReturn JSON only.`;
  return note ? `${head}\n\n${note}` : head;
}

function topUpNote(short) {
  const rows = short.map((r) => `${r.slot} (have ${r.have}, need ${r.need})`).join('; ');
  return `TOP-UP: the first reply was short. Write only the missing items for these slots, same rules: ${rows}.`;
}

module.exports = { earlierStems, levelTally, promptValues, userPrompt, topUpNote };
