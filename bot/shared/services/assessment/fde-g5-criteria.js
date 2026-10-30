'use strict';
/**
 * Two Urdu composition rubrics that contradicted their paper (bd-5jmnfj.4.58.4). The key prints a
 * composition's marking rows from the composition-criteria template, not from scheme.points.
 *
 * - G5 Urdu Q7 (picture description): the template's «عنوان» row paid 1 mark for a title the instruction never
 *   asks for, and the key printed the scene's one-line name «پارک کی سیر» as if it were question text. The
 *   unasked title row goes, its mark joins the first row kept; the scene name stays off the key.
 * - G5 Urdu Q8 (dialogue): the template asked «کم از کم آٹھ باتیں» while the stem asks «دس سے بارہ جملے»;
 *   the row takes the stem's own wording.
 *
 * Pure: rows in, rows out; never throws.
 */

const { alignCriteria } = require('./fde-g5-criteria-2');

const TITLE = /^عنوان/; // a row that opens with the title; the application form row lists عنوان among its parts (v37 Q10)
const THIN = /کم از کم آٹھ باتیں/;
const COUNT = /(\S+)\s+سے\s+(\S+)\s+جملے/;

const stemOf = (slot) => [slot && slot.instruction_ur, ...((slot && slot.or_parts_ur) || [])].filter(Boolean).join(' ');

/** The slot's rows with an unasked title row dropped and the stem's sentence count in place of «آٹھ باتیں». */
function adjustCriteria(rows, slot) {
  if (!Array.isArray(rows) || !slot) return rows;
  const stem = stemOf(slot);
  let out = alignCriteria(rows, slot);
  if (/^urdu\./.test(slot.slot) && !TITLE.test(stem) && out.some((r) => TITLE.test(r.name))) {
    const moved = out.filter((r) => TITLE.test(r.name)).reduce((s, r) => s + r.marks, 0);
    const kept = out.filter((r) => !TITLE.test(r.name));
    if (kept.length) out = kept.map((r, i) => (i === 0 ? { ...r, marks: r.marks + moved } : r));
  }
  const count = COUNT.exec(stem);
  if (count && out.some((r) => THIN.test(r.name))) {
    out = out.map((r) => (THIN.test(r.name) ? { ...r, name: r.name.replace(THIN, `${count[1]} سے ${count[2]} جملے`) } : r));
  }
  return out;
}

/** True when the key must not echo the item's `question`: a picture description's is only the scene's name. */
function keyStemHidden(slot) {
  return Boolean(slot && /^urdu\./.test(slot.slot) && (slot.kinds || []).includes('picture_description'));
}

module.exports = { adjustCriteria, keyStemHidden };
