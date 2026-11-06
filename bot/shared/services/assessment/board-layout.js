'use strict';
/**
 * The `_layout` of a G6-12 board paper (SPEC §7): a pure, frozen-input-safe copy of what the pattern variant
 * says the paper looks like, taken at generation time so a stored paper never changes when a pattern is
 * edited (same stored-paper rule as fde-layout.js, which this module never calls).
 *
 *   buildLayout(pattern, variant, examJson) ->
 *     { profile:'board', variant, medium, rtl, header, sections[{id, marks, time_min, answer_on, parts}],
 *       slots[{section, slot, label, type, printed, attempt, generate, marks_each, marks, or, stimulus,
 *              teacher_marked, project}], legend, scheme_style }
 *
 * `pattern` is a whole board pattern (subject picked by `examJson.subject`) or a bare subject entry.
 * Slot counts and marks are copied from the entry, never invented. Totals are re-summed in x4 integers
 * (FBISE halves and quarters) and must equal the variant's declared totals, else LayoutTotalError.
 * Teacher-marked (project) slots generate no items but count in every total.
 *
 * design_pending (SPEC §7 gives no field list for these, smallest reading taken):
 *   - `medium` / `rtl` are added so the renderer need not re-read the subject (rtl = medium 'ur').
 *   - `parts` is copied as the entry gives it (null when absent); the layout does not interpret handover.
 *   - `section` and `type` / `generate` / `project` are carried on each slot so one flat list is enough.
 */

class LayoutTotalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LayoutTotalError';
  }
}

const x4 = (m) => Math.round(m * 4);
const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

function subjectOf(pattern, examJson) {
  if (!pattern) throw new Error('board-layout: pattern is required');
  if (!pattern.subjects) return pattern;
  const key = examJson && examJson.subject;
  const s = pattern.subjects[key];
  if (!s) throw new Error(`board-layout: unknown subject ${JSON.stringify(key)} in pattern ${pattern.id}`);
  return s;
}

/** What a slot is worth: attempt x marks_each (a project slot is worth its own marks). */
function slotMarks4(slot) {
  const each = slot.project ? slot.project.marks : slot.marks_each;
  return x4(each) * (slot.attempt || 1);
}

function layoutSlot(sectionId, s) {
  const marksEach = s.marks_each;
  return {
    section: sectionId,
    slot: s.slot,
    label: s.label_en,
    label_ur: s.label_ur || null,
    type: s.type,
    printed: s.printed,
    attempt: s.attempt,
    generate: s.project ? 0 : s.generate,
    marks_each: marksEach,
    marks: slotMarks4(s) / 4,
    or: copy(s.or) || null,
    stimulus: copy(s.stimulus) || null,
    teacher_marked: Boolean(s.teacher_marked || s.project),
    project: copy(s.project) || null,
    parts: copy(s.parts) || null,
  };
}

function layoutSection(sec) {
  const slots = (sec.slots || []).map((s) => layoutSlot(sec.id, s));
  const total4 = slots.reduce((n, s) => n + x4(s.marks), 0);
  if (sec.marks != null && x4(sec.marks) !== total4) {
    throw new LayoutTotalError(`board-layout: section ${sec.id} slots add up to ${total4 / 4}, not the declared ${sec.marks}`);
  }
  return {
    section: {
      id: sec.id, marks: total4 / 4, time_min: sec.time_min == null ? null : sec.time_min,
      answer_on: sec.answer_on, parts: copy(sec.parts) || null,
    },
    slots,
  };
}

function buildLayout(pattern, variant, examJson) {
  const subject = subjectOf(pattern, examJson);
  if (!variant || !Array.isArray(variant.sections)) throw new Error('board-layout: variant with sections is required');
  const built = variant.sections.map(layoutSection);
  const sections = built.map((b) => b.section);
  const total4 = sections.reduce((n, s) => n + x4(s.marks), 0);
  if (x4(variant.total_marks) !== total4) {
    throw new LayoutTotalError(`board-layout: paper sections add up to ${total4 / 4}, not the variant's total_marks ${variant.total_marks}`);
  }
  return {
    profile: 'board',
    variant: variant.variant_id,
    medium: subject.medium || null,
    rtl: subject.medium === 'ur',
    header: copy(variant.exam_header) || null,
    sections,
    slots: built.flatMap((b) => b.slots),
    legend: copy(subject.legend) || null,
    scheme_style: variant.scheme_style,
  };
}

module.exports = { buildLayout, LayoutTotalError };
