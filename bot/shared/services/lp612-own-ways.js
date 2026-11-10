/**
 * bd-snkn32.13 — "Make my own" for grades 6–12: the teaching ways and lesson purposes each grade band is offered.
 *
 * The primary ways (lp612-own-instruction WAYS: sounds first, things → pictures → numbers, teach at the right level)
 * are for grades 1–5. Grades 6–8 ("middle") and 9–12 ("senior") get ways that fit a subject teacher's lesson; the
 * portal orders them by subject, the bot only checks a way is in her band. Board-exam practice (FBISE) is 9–12 only:
 * there is no board exam below Grade 9. Grade 8 alone gets FDE exam practice the FDE's centralised
 * annual exam (circular 2 Jan 2026). Every way is taught INSIDE We do and You do; none replaces a phase (GRR_LINE), and
 * none is rote (ROTE_LINE): both lines ride in every "Make my own" instruction, 1–5 and 6–12, make and change.
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
  writing: 'Model, plan, write: the teacher models a short text of the page\'s type, the class plans one together, each child writes, then checks it against 3 points.',
  past_paper: 'Past-paper practice: FBISE board-exam style questions on these pages (MCQs, short and long answers), practised with reasoning, with model answers and how marks are given; never memorised answers.',
  exam_fde: 'Exam practice (FDE): questions in the style of the FDE Grade 8 centralised annual exam on these pages (MCQs, short and long answers), practised with reasoning, with model answers and how marks are given; never memorised answers.',
};

const MIDDLE = ['worked', 'numericals', 'practical', 'inquiry', 'concept_map', 'discussion', 'reading', 'writing'];
const SENIOR = [...MIDDLE, 'past_paper'];

/** the two rules no way, answer or change can lift. */
const GRR_LINE = 'Keep I do, We do and You do, in that order; a way changes how a phase is taught, never removes it.';
const ROTE_LINE = 'Never turn any part into rote drill: no repeat-after-me lists, copying or memorising word for word. '
  + 'Choral sound and word practice (phonics) is allowed and is not rote.';

const PURPOSES = {
  new: 'Lesson purpose: teach these pages for the first time. Build the ideas from what children already know.',
  revise: 'Lesson purpose: revision. The class has been taught these pages: recall the key ideas quickly, then spend most of the time on practice and fixing mistakes.',
  board: 'Lesson purpose: board exam practice. Use FBISE past-paper style questions on these pages (MCQs, short and long answers). Tag every question with its Bloom\'s level (Knowledge, Understanding or Application) and the SLO code it tests. Show how marks are given.',
  reteach: 'Lesson purpose: re-teach. The class was taught these pages but did not understand: start from the common mistakes, explain in a new way, and check understanding more often.',
};

/**
 * Grade 8's exam practice (the portal's "Exam practice (FDE)"): purpose code `board`, as 9–12, so the
 * portal sends one code; at Grade 8 it reads as the FDE centralised annual exam, never FBISE.
 */
const PURPOSE_FDE = 'Lesson purpose: exam practice for the FDE Grade 8 centralised annual exam. Use exam-style questions on these pages (MCQs, short and long answers). Tag every question with its Bloom\'s level (Knowledge, Understanding or Application) and the SLO code it tests. Show how marks are given.';

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

/** Her book's text for the rewrite, cut to fit (spec item 13: teach from the real page); '' when there is none. */
const BOOK_MAX = 6000;
function bookLine(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return '';
  const cut = t.length > BOOK_MAX ? `${t.slice(0, BOOK_MAX)} …` : t;
  return `From her book (the text of these pages: teach from it and name the page; do not copy it out whole):\n${cut}`;
}

/** the 6–12 way codes for one grade: her band's set, plus FDE exam practice at Grade 8 only. */
function waysOfGrade(grade) {
  const ways = waysOfBand(bandOf(grade));
  return Number(grade) === 8 ? [...ways, 'exam_fde'] : ways;
}

/** The purposes offered in a band, in order (none for primary). */
function purposesOfBand(band) {
  if (band === 'middle') return ['new', 'revise', 'reteach'];
  if (band === 'senior') return ['new', 'revise', 'board', 'reteach'];
  return [];
}

/** The purposes for one grade, in order: her band's, plus exam practice (`board`, FDE) at Grade 8. */
function purposesOfGrade(grade) {
  if (Number(grade) !== 8) return purposesOfBand(bandOf(grade));
  return ['new', 'revise', 'board', 'reteach'];
}

/** The purpose line: `board` at Grade 8 is the FDE exam, else the band's text. */
function purposeLine(purpose, grade) {
  if (purpose === 'board' && Number(grade) === 8) return PURPOSE_FDE;
  return PURPOSES[purpose] || '';
}

module.exports = {
  purposesOfGrade, purposeLine, PURPOSE_FDE,
  SECONDARY_WAYS, PURPOSES, GRR_LINE, ROTE_LINE, BOOK_MAX, bookLine, bandOf, gradeOfSegment, waysOfBand, waysOfGrade, purposesOfBand,
};
