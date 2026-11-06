'use strict';
/** One pre-rendered prompt line per slot for eg.task.board_section's {slot_lines} (prompts contract §4). Pure. */

/** quota (optional, rubric A6b): {level: count} for this slot's items; zero levels are left out. */
function slotLine(s, quota) {
  const head = `- ${s.label_en} [slot ${s.slot}]:`;
  if (s.teacher_marked || s.project) {
    const p = s.project || {};
    return `${head} TEACHER-MARKED, ${p.marks != null ? p.marks : s.marks_each} marks; ${p.instruction_en || ''}; write no items`;
  }
  let line = `${head} ${s.generate} x ${s.type} at ${s.marks_each} marks`;
  if (s.attempt < s.printed) line += `; attempt any ${s.attempt} of ${s.printed}, write all ${s.printed}`;
  if (s.or) {
    const br = s.or.branches || [];
    line += `; OR: write both alternatives (${br.map((b) => b.type).join(' / ')}) at ${s.marks_each} marks each`;
  }
  if (s.prompt_rule === 'internal_or') line += `; each item offers an internal OR: write both alternatives at ${s.marks_each} marks each`;
  if (s.stimulus) {
    line += `; stimulus: ${s.stimulus.count} texts (${(s.stimulus.kinds || []).join(' / ')}), ${s.stimulus.mcqs_per_stimulus} items each, text only`;
  }
  const lv = quota && typeof quota === 'object' ? Object.keys(quota).filter((k) => quota[k] > 0) : [];
  if (lv.length) line += `; levels: ${lv.map((k) => `${k} ${quota[k]}`).join(', ')}`;
  return line;
}

module.exports = { slotLine };
