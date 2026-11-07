'use strict';
/**
 * A slot the teacher writes before photocopying (bd-5jmnfj.39.1, G5 Islamiat Q3: the dua or durood
 * the child translates). The model is never asked for it, so it holds no item and is full by
 * definition. On the paper it prints its head, the teacher's note and a writing space; in the
 * marking scheme, one row saying she marks it herself. The engine never prints sacred text here.
 * Pure: no I/O.
 */

// Styled inline like the oral sheet's: the shared CSS is pinned byte for byte by the goldens.
const FILL_LINE = '<div class="fill-line" style="border-bottom: 1px solid #000; height: 9mm;"></div>';

/** The items a slot counts as holding: a teacher-filled slot holds what it must answer. */
const counted = (slot, n) => (slot && slot.teacher_fills ? slot.attempt : n);

/** @param {(value: string, ctx: object) => string} text  the renderer's escaping text helper */
function paperBlock(slot, head, ctx, text) {
  const note = slot[`teacher_note_${ctx.medium}`] || slot.teacher_note_en;
  const noteHtml = note ? `<div class="teacher-note"><i>«${text(note, ctx)}»</i></div>` : '';
  return `<div class="slot">${head}<div class="q" data-slot="${slot.slot}" data-teacher-fills="1">${noteHtml}${FILL_LINE.repeat(slot.lines || 0)}</div></div>`;
}

/** The scheme's row for a teacher-filled slot; '' for any other slot. */
function keyRow(slot, label, ctx, text) {
  if (!slot || !slot.teacher_fills) return '';
  const note = slot[`key_note_${ctx.medium}`] || slot.key_note_en || '';
  const marks = slot.attempt * slot.marks_each;
  return `<tr data-row="${slot.slot}"><td class="n">${text(label, ctx)}</td><td class="ans">${text(note, ctx)}</td><td class="pts">${text(String(marks), ctx)}</td></tr>`;
}

module.exports = { counted, paperBlock, keyRow };
