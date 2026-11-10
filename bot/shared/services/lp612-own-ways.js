/**
 * bd-snkn32.13 — "Make my own" for grades 6–12: the teaching ways and lesson purposes each grade band is offered.
 *
 * The primary ways (lp612-own-instruction WAYS: sounds first, things → pictures → numbers, teach at the right level)
 * are for grades 1–5. Grades 6–8 ("middle") and 9–12 ("senior") get ways that fit a subject teacher's lesson; the
 * portal orders them by subject, the bot only checks a way is in her band. Board-exam practice (FBISE) is 9–12 only:
 * there is no board exam below Grade 9.
 *
 * Pure: no I/O.
 */

const SECONDARY_WAYS = {
  worked: 'Worked examples: the teacher solves one on the board, thinking aloud; the class solves the next one together; then each child solves one alone.',
  numericals: 'Numericals step by step: write what is given, the formula, the substitution and the answer with its unit, one step per line; then children solve similar numericals.',
  practical: 'Demonstration or practical: a simple demonstration or activity with what the teacher has; children predict, observe, record and explain what they saw.',
  inquiry: 'Inquiry: start from a question or puzzle from the page; children predict and reason, then check their ideas against the book.',
  concept_map: 'Concept map: build a map of the key ideas and how they link on the board, with children adding to it.',
  discussion: 'Structured discussion: think-pair-share and short group talk on a question from the page; children give reasons, not only answers.',
  reading: 'Close reading: read the text in parts, mark key words and ideas, answer in their own words, then write.',
  past_paper: 'Past-paper practice: FBISE board-exam style questions on these pages (MCQs, short and long answers), with model answers and how marks are given.',
};

const MIDDLE = ['worked', 'numericals', 'practical', 'inquiry', 'concept_map', 'discussion', 'reading'];
const SENIOR = [...MIDDLE, 'past_paper'];

const PURPOSES = {
  new: 'Lesson purpose: teach these pages for the first time. Build the ideas from what children already know.',
  revise: 'Lesson purpose: revision. The class has been taught these pages: recall the key ideas quickly, then spend most of the time on practice and fixing mistakes.',
  board: 'Lesson purpose: board exam practice. Use FBISE past-paper style questions on these pages (MCQs, short and long answers). Tag every question with its Bloom\'s level (Knowledge, Understanding or Application) and the SLO code it tests. Show how marks are given.',
  reteach: 'Lesson purpose: re-teach. The class was taught these pages but did not understand: start from the common mistakes, explain in a new way, and check understanding more often.',
};

/** 'primary' (1–5), 'middle' (6–8), 'senior' (9–12), or null. */
function bandOf(grade) {
  const g = Number(grade);
  if (!Number.isInteger(g) || g < 1 || g > 12) return null;
  if (g <= 5) return 'primary';
  return g <= 8 ? 'middle' : 'senior';
}

/** The grade a 6–12 segment id names (`grade_10_chemistry.c01.p001-003` → 10), or null. */
function gradeOfSegment(segmentId) {
  const m = typeof segmentId === 'string' ? /^grade_(\d{1,2})_/.exec(segmentId) : null;
  return m ? Number(m[1]) : null;
}

/** The 6–12 way codes for a band ([] for primary: its ways live in lp612-own-instruction). */
function waysOfBand(band) {
  if (band === 'middle') return MIDDLE.slice();
  if (band === 'senior') return SENIOR.slice();
  return [];
}

/** The purposes offered in a band, in order (none for primary). */
function purposesOfBand(band) {
  if (band === 'middle') return ['new', 'revise', 'reteach'];
  if (band === 'senior') return ['new', 'revise', 'board', 'reteach'];
  return [];
}

module.exports = {
  SECONDARY_WAYS, PURPOSES, bandOf, gradeOfSegment, waysOfBand, purposesOfBand,
};
