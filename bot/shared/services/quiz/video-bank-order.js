'use strict';
/**
 * The video bank's one order: grade, subject, chapter, title. The WhatsApp Student
 * Videos Flow and the web library both sort with these, so a child sees the same
 * order on either surface.
 *
 * Text order, on purpose: the bank has no chapter number, so "Chapter 10" sorts before
 * "Chapter 2"; subjects compare by code unit (Array#sort's default). Pure, no I/O.
 */

const GRADE_ORDER = ['NURSERY', 'KG', '1', '2', '3', '4', '5', '6'];

/** Position of a grade in GRADE_ORDER; anything else sorts after 6. */
function gradeRank(g) {
  const i = GRADE_ORDER.indexOf(String(g));
  return i === -1 ? 99 : i;
}

function compareSubjects(a, b) {
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Lower-cased clean_chapter, then lower-cased clean_title. */
function compareVideos(a, b) {
  const ac = (a.clean_chapter || '').toLowerCase();
  const bc = (b.clean_chapter || '').toLowerCase();
  if (ac !== bc) return ac < bc ? -1 : 1;
  const at = (a.clean_title || '').toLowerCase();
  const bt = (b.clean_title || '').toLowerCase();
  return at < bt ? -1 : at > bt ? 1 : 0;
}

module.exports = { GRADE_ORDER, gradeRank, compareSubjects, compareVideos };
