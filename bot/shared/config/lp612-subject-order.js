'use strict';
/**
 * The order subjects are offered in, core before elective.
 *
 * WHY THIS EXISTS — bd-y5vx3
 * --------------------------
 * Both subject menus sorted with a bare `localeCompare`, so grade 9 opened
 *
 *     Biology · Chemistry · Computer Science · English · General Science · Islamiyat ·
 *     Mathematics · Pakistan Studies · Physics · Urdu
 *
 * — the three elective science papers ahead of every compulsory subject, and English, the one a
 * teacher opening this menu is most likely to want, sixth. On a WhatsApp NavigationList the first
 * rows are the ones that get read; alphabetical order is not neutral there, it is a ranking, and
 * it happened to rank the subjects the fewest teachers teach at the top.
 *
 * The operator's instruction (2026-09-12) was the compulsory subjects first, in teaching order:
 * English, Urdu, Math, General Science, "etc etc". CORE below is that list continued into the
 * FBISE compulsory group (Islamiyat and Pakistan Studies are compulsory at SSC and HSSC), then
 * the elective group papers the sciences split into from grade 9. Anything not named falls to an
 * alphabetical tail, so a subject can never DISAPPEAR from a menu by not being on this list —
 * the one failure mode an ordering policy must not have.
 *
 * WHY THE ALIASES
 * ---------------
 * `subject` is free text carried in from the segmentation import, and the corpus holds several
 * spellings of the same subject: `Mathematics` and `mathematics`, `General Science` and
 * `Science`, `Islamiyat` and `Islamiat`, `Computer Science` and `Computer Studies`. Matching the
 * literal string would rank one spelling and drop its twin into the alphabetical tail — the menu
 * would then look sorted for grade 6 and unsorted for grade 7 with no visible reason. Matching is
 * case-insensitive, whitespace-collapsed, and goes through ALIASES first.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not a curriculum statement and nothing reads it as one. It orders rows in a picker.
 */

/** Compulsory first, in teaching order, then the elective group papers. */
const CORE = Object.freeze([
  'english',
  'urdu',
  'mathematics',
  'general science',
  'islamiyat',
  'religious studies',
  'pakistan studies',
  'social studies',
  // From grade 9 the single science paper splits into the elective group. These sit after the
  // compulsory block but ahead of the tail, because a science teacher's subject is one of these.
  'physics',
  'chemistry',
  'biology',
  'computer science',
]);

/** Spellings the corpus actually carries, mapped onto the CORE key they mean. */
const ALIASES = Object.freeze({
  math: 'mathematics',
  maths: 'mathematics',
  'math.': 'mathematics',
  science: 'general science',
  'gen science': 'general science',
  'general sciences': 'general science',
  islamiat: 'islamiyat',
  islamiyaat: 'islamiyat',
  'islamic studies': 'islamiyat',
  اسلامیات: 'islamiyat',
  اردو: 'urdu',
  'pak studies': 'pakistan studies',
  'مطالعہ پاکستان': 'pakistan studies',
  'computer studies': 'computer science',
  computers: 'computer science',
});

/** Lower-cased, trimmed, inner whitespace collapsed — then run through ALIASES. */
function normalizeSubject(subject) {
  const s = String(subject == null ? '' : subject).trim().replace(/\s+/g, ' ').toLowerCase();
  return ALIASES[s] || s;
}

/**
 * Rank within CORE, or `CORE.length` for everything else — one bucket, not a scatter, so the
 * tail stays internally alphabetical rather than arbitrary.
 */
function subjectRank(subject) {
  const i = CORE.indexOf(normalizeSubject(subject));
  return i < 0 ? CORE.length : i;
}

/**
 * Comparator for `Array#sort` over raw subject strings: declared order first, then alphabetical
 * for everything the list does not name. The alphabetical fallback also settles two spellings of
 * the same CORE subject appearing in one grade, so the sort is total and stable across runs.
 */
function compareSubjects(a, b) {
  const d = subjectRank(a) - subjectRank(b);
  return d !== 0 ? d : String(a).localeCompare(String(b));
}

module.exports = { CORE, ALIASES, normalizeSubject, subjectRank, compareSubjects };
