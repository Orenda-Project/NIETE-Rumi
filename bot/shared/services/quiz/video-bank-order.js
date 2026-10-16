'use strict';
/**
 * The video bank's one order: grade, subject, chapter, title. The WhatsApp Student
 * Videos Flow and the web library both sort with these, so a child sees the same
 * order on either surface.
 *
 * Text order, on purpose: the bank has no chapter number, so "Chapter 10" sorts before
 * "Chapter 2"; subjects compare by code unit (Array#sort's default). Pure, no I/O.
 *
 * compareVideosNatural is the web library's order under app_settings `web_quiz_videos_v3`: numbers in a
 * chapter or title compare as numbers ("Chapter 2" before "Chapter 10", "باب ۲" before "باب ۱۰").
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

// Urdu (U+06F0-06F9) and Arabic-Indic (U+0660-0669) digits read as 0-9, so the collator sees one number.
const digits = (t) => String(t || '').replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
  .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
const NATURAL = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** clean_chapter, then clean_title, numbers as numbers, case ignored. */
function compareVideosNatural(a, b) {
  return NATURAL.compare(digits(a.clean_chapter), digits(b.clean_chapter))
    || NATURAL.compare(digits(a.clean_title), digits(b.clean_title));
}

module.exports = { GRADE_ORDER, gradeRank, compareSubjects, compareVideos, compareVideosNatural };
