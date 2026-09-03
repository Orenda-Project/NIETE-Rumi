/**
 * Subject families for the 6-12 lesson-plan author.
 *
 * PORTED, NOT INVENTED. The mapping below is a behaviour-for-behaviour port of
 * the upstream bake-off harness — `lp_author/author_lp.py`, `FAMILIES`,
 * `_FAMILY_KEYS` and `family_for_book()`. It must stay in step with upstream: if
 * the serving lane and the harness classified a book differently, every bake-off
 * number would describe a harness we do not actually run, and the family briefs
 * would be measured against the wrong cohort.
 *
 * WHY FAMILIES EXIST AT ALL
 *
 * Round 2c of the bake-off ran the natural experiment: ONE global maths preamble
 * cut maths defects 31% and made Urdu prose 73% WORSE. The blocking-defect census
 * over 51 documents explains it — MATH_LEAK occurs 107 times in maths, once in
 * science and never in prose, while RELIGIOUS_MARKS and DISTRACTOR_VISIBLE occur
 * only in prose. A single global rule set therefore spends ~1,200 characters of
 * the model's attention on rules irrelevant to two families out of three, and
 * crowds out the ones that are not. Conditioning on the family took maths from
 * 11.8 to 5.6 blocking defects per document.
 *
 * `sci` IS THE FALLBACK ON PURPOSE. It is the WIDEST variant — the common core
 * plus light diagram/equation guidance — so an unrecognised book gets the shared
 * rules and no subject-specific block that might mislead it. Falling back to
 * `maths` would reintroduce exactly the round-2c harm on any book we failed to
 * classify.
 *
 * ORDER IS LOAD-BEARING. The table is scanned in order and the first family with
 * a matching key wins, so `grade_9_computer_studies_urdu` is prose (it is an
 * Urdu-medium language book) rather than sci via "computer". Reordering this
 * table silently reclassifies books; a test locks the precedence.
 */

const FAMILIES = Object.freeze(['maths', 'sci', 'prose']);

/**
 * Keyed on `book_stem`, which `niete_lp612_segments` carries NOT NULL, so a
 * family is always resolvable at authoring time without a second lookup.
 */
const FAMILY_KEYS = Object.freeze([
  ['maths', ['mathematics', 'maths', 'math', 'physics']],
  ['prose', ['urdu', 'english', 'islamiat', 'language', 'literature', 'history',
    'social_studies', 'pakistan_studies']],
  ['sci', ['biology', 'chemistry', 'science', 'computer']],
]);

/** The fallback. Named rather than inlined so the reason above stays attached. */
const FALLBACK_FAMILY = 'sci';

/**
 * Which preamble variant a book gets.
 *
 * @param {string} bookStem e.g. 'grade_9_physics'
 * @returns {'maths'|'sci'|'prose'}
 */
function familyForBook(bookStem) {
  const s = String(bookStem || '').toLowerCase();
  for (const [family, keys] of FAMILY_KEYS) {
    if (keys.some((k) => s.includes(k))) return family;
  }
  return FALLBACK_FAMILY;
}

module.exports = {
  FAMILIES,
  FAMILY_KEYS,
  FALLBACK_FAMILY,
  familyForBook,
};
