'use strict';
/**
 * Composition rows that pay for what the paper never asked (bd-5jmnfj.4.58.34, v29 G5 review).
 *
 * - Urdu dialogue (Q8): the template paid «مواد: کم از کم آٹھ باتیں اور نتیجہ» plus a form row, weighing 2/5/2/1
 *   against the essay's 6/3/1. A dialogue has no result, the dialogue part prints no sentence count or layout:
 *   the rows become content 6, language 3, neatness 1, the same as the essay.
 * - Urdu letter (Q10): «مقام و تاریخ» became «تاریخ»; the model letter prints a date and no place.
 * - English paragraph, letter and application: the «Neatness and length» row quoted a length (sentences or words)
 *   that FDE and the instruction never set; it becomes «Neatness» unless the instruction states a length.
 *
 * Pure: rows in, rows out; never throws.
 */

const DIALOGUE_ROW = /اور نتیجہ/;
const FORM_ROW = /^شکل:/;
const PLACE = /مقام و تاریخ/;
const LENGTH_ROW = /length/i;
const STATED = /\b\d+\s*(?:to|-|–)\s*\d+\s+(?:words|sentences)\b|\b\d+\s+(?:words|sentences)\b/i;

const stemOf = (slot) => [slot.instruction_ur, ...(slot.or_parts_ur || [])].filter(Boolean).join(' ');

function dialogue(rows, slot) {
  if (!(slot.kinds || []).includes('dialogue') || !rows.some((r) => DIALOGUE_ROW.test(r.name))) return rows;
  if (/نتیجہ/.test(stemOf(slot))) return rows;
  const total = rows.reduce((s, r) => s + r.marks, 0);
  if (total !== 10) return rows;
  const lang = rows.find((r) => r.name === 'زبان');
  const neat = rows.find((r) => r.name === 'صفائی');
  return [
    { name: 'مواد: موضوع سے متعلق مکالمہ', marks: 6 },
    { ...(lang || { name: 'زبان' }), marks: 3 },
    { ...(neat || { name: 'صفائی' }), marks: 1 },
  ];
}

function englishLength(rows, slot) {
  if (!rows.some((r) => LENGTH_ROW.test(r.name))) return rows;
  if (STATED.test(String(slot.instruction_en || ''))) return rows;
  return rows.map((r) => (LENGTH_ROW.test(r.name) ? { name: 'Neatness', marks: r.marks, look_for: 'neat, tidy handwriting' } : r));
}

/** The slot's rows with unasked dialogue, place and length rows corrected. */
function alignCriteria(rows, slot) {
  if (!Array.isArray(rows) || !slot || typeof slot.slot !== 'string') return rows;
  if (/^english\./.test(slot.slot)) return englishLength(rows, slot);
  if (!/^urdu\./.test(slot.slot)) return rows;
  const out = dialogue(rows, slot);
  return out.map((r) => (FORM_ROW.test(r.name) && PLACE.test(r.name) ? { ...r, name: r.name.replace(PLACE, 'تاریخ') } : r));
}

module.exports = { alignCriteria };
