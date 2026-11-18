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
const { quotaFor } = require('../board-checks/_level-quota');

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
    slot_lines: unit.slots.map((s) => slotLine(s, s.quota || (split ? quotaFor(Number(s.generate) || 0, split.levels) : null))).join('\n'),
    earlier_stems_short: earlierStems(done),
    level_tally: Object.keys(tally).length ? render(tally, ', ') : 'none yet',
    split_remaining: remaining,
  };
}

function userPrompt({ content, pageReference, note }) {
  const head = `Write the section named in the task from this book text.\nPages: ${pageReference || 'whole selection'}\n\n**Book Text Content:**\n\`\`\`\n${content}\n\`\`\`\n\nReturn JSON only.`;
  return note ? `${head}\n\n${note}` : head;
}

/** `used` (the repair round): keys already in the paper, which a new stem or stimulus must not state. */
const usedLine = (used) => `Do not state any of these answers in a new stem or stimulus; they are already keys in this paper: ${used.map((k) => `"${k}"`).join('; ')}`;

/** `r.write` (round 4): the top-up asks for the shortfall plus about a quarter; code trims back to the slot. */
function topUpNote(short, used = []) {
  const rows = short.map((r) => `${r.slot} (have ${r.have}, need ${r.need}${r.write != null ? `; write ${r.write}` : ''})`).join('; ');
  const head = `TOP-UP: the first reply was short. Write only the missing items for these slots, same rules: ${rows}.`;
  if (!used.length) return head;
  return `${head}\n${usedLine(used)}`;
}

/** A later chunk of a long slot: which items it writes; the earlier stems are in the task, the keys are listed here. */
function chunkNote(chunk, used = []) {
  const head = `CHUNK: items ${chunk.from}-${chunk.to} of slot ${chunk.slot} (${chunk.total} in all). Items 1-${chunk.from - 1} are written; do not repeat their stems.`;
  return used.length ? `${head}\n${usedLine(used)}` : head;
}

/** Round 5: one targeted rewrite of items the checks removed; nothing new is asked for the slot. */
const FIGURE_LINE = 'Some removed items referred to a graph or figure the paper does not print: print the data the student needs (a table or the values) in the stem or passage, or ask the idea without referring to a graph or figure.';

function rewriteNote(rows, stems = [], used = [], phrases = [], figure = false, faults = []) {
  const list = rows.map((r) => `${r.slot} (rewrite ${r.write})`).join('; ');
  const lines = [`REWRITE: some items failed the checks and were removed. Write replacements only, same rules: ${list}.`];
  if (stems.length) lines.push(`Do not reuse these stems: ${stems.map((x) => `"${x}"`).join('; ')}`);
  // round 6: the keyed item's second rewrite; these phrases already sit in other stems of the section
  if (phrases.length) lines.push(`Do not use these phrases: ${phrases.map((x) => `"${x}"`).join('; ')} (not as a key, an option or in a stem).`);
  // round 9b: what the MCQ reviewer found wrong with the removed items
  if (faults.length) lines.push(`A reviewer removed these items for these faults; do not repeat them: ${faults.join('; ')}`);
  if (figure) lines.push(FIGURE_LINE); // round 7: an N20 drop (no figure ever prints, DESIGN R9)
  if (used.length) lines.push(usedLine(used));
  return lines.join('\n');
}

// round 10: deterministic checks whose drop the rewrite should be told about, as a reviewer fault would be
const CHECK_FAULTS = {
  D18: 'the key stood out (longest option, or always/never); write all four options the same length and detail, the key no longer than the longest distractor',
  D22: 'its scheme had only a final-answer mark; list method/working step marks (formula, substitution, working) apart from the final-answer mark (value with unit)',
  D17: 'it asked the same as another question in this section; ask about a different fact or idea from the pages', // bd-qyi45h.14
  D13: 'its options broke the MCQ rules, or it had the same answer letter as the questions just before it; write four different options labelled A) to D) with the key one of them, and when the options are numbers (printed in ascending order) choose the values so the correct one sits at a different letter from the questions before it', // bd-qyi45h.16
};
const checkFaults = (gone) => gone.filter((x) => CHECK_FAULTS[x.check]).map((x) => `"${x.question}": ${CHECK_FAULTS[x.check]}`);

module.exports = { levelPart, earlierStems, levelTally, promptValues, userPrompt, topUpNote, chunkNote, rewriteNote, checkFaults };
