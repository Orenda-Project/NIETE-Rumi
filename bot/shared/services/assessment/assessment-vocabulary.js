'use strict';
/**
 * How a grade and a subject are NAMED, in one place.
 *
 * Two small maps that were, until this module, copied verbatim into three files:
 * the Flow endpoint (as SUBJECT_TITLE), the orchestrator and the revision
 * service (both as SUBJECT_LABEL). Identical in all three, which is precisely
 * the state a fourth copy is added in — the portal was about to be that fourth
 * copy, and the dead portal panel already carried its own divergent set
 * (`Eng`, `GenK`, `Islamiyat`) left over from the UG_EG generator.
 *
 * A label that disagrees across surfaces is not cosmetic. It reaches the
 * filename a teacher sees in her downloads, the caption on the document, and
 * the heading printed on the paper itself, so two surfaces can hand the same
 * teacher the same paper under two different names.
 */

/** The printable name of a subject. Keys are the subject_code values. */
const SUBJECT_LABEL = {
  english: 'English',
  urdu: 'Urdu',
  maths: 'Maths',
  islamiat: 'Islamiat',
  science: 'Science',
  general_knowledge: 'General Knowledge',
  social_studies: 'Social Studies',
};

/**
 * Which grades a subject is actually taught in.
 *
 * Science and Social Studies start at Grade 4; General Knowledge stops at
 * Grade 3. A subject with no entry here is taught in every grade we hold.
 *
 * This is not the same question as "do we have the book". A book can exist for
 * a grade the subject is not taught in, and offering it produces a refusal she
 * cannot act on — so both filters have to run.
 */
const GRADE_BANDS = {
  science: [4, 5],
  social_studies: [4, 5],
  general_knowledge: [1, 2, 3],
};

/** The printable name, falling back to the code so nothing renders blank. */
function subjectLabel(subject) {
  return SUBJECT_LABEL[subject] || subject;
}

/** Is this subject taught in this grade? */
function taughtIn(subject, grade) {
  const band = GRADE_BANDS[subject];
  return !band || band.includes(Number(grade));
}

/**
 * A question type, short enough to sit after the marks on a 20-code-point list
 * row ("2 marks · Short"). Keys are compared lower-cased with the spaces around
 * a slash removed, because the model writes "True / False" and "True/False".
 */
const SHORT_TYPE = {
  mcqs: 'MCQ', mcq: 'MCQ', msqs: 'MSQ', msq: 'MSQ', 'true/false': 'T/F',
  'fill in the blanks': 'Blanks', blanks: 'Blanks', 'match the column': 'Match',
  'brief answers': 'Brief', 'short questions': 'Short', 'short question': 'Short',
  'short answer': 'Short', 'long question': 'Long', 'long questions': 'Long',
  'long answers': 'Long', 'detailed answers': 'Long', 'word meanings': 'Meanings',
  'word sentences': 'Sentences', 'comprehension passage': 'Passage',
  'missing letters': 'Letters', 'circle the correct answer': 'Circle',
  'rewrite sentences': 'Rewrite', 'word problems': 'Problems',
  'restricted response question': 'Short',
};

function shortType(type) {
  const raw = String(type || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/\s*\/\s*/g, '/');
  if (SHORT_TYPE[key]) return SHORT_TYPE[key];
  const first = raw.split(' ')[0];
  return [...first].slice(0, 10).join('');
}

/**
 * The shared instruction printed over a type she started herself. Chosen by
 * the direction the PAPER is set in (the subject), not by the teacher's chat
 * language: it is printed for the children, beside the model's own copy. The
 * copy lives in the catalog (assessmentInstruction*).
 */
const INSTRUCTION_KEY = {
  mcq: 'assessmentInstructionMcq',
  short: 'assessmentInstructionShort',
  long: 'assessmentInstructionLong',
  fill: 'assessmentInstructionFill',
};

function defaultInstruction(kind, rtl) {
  const { UX_STRINGS } = require('../../config/ux-strings');
  const entry = UX_STRINGS[INSTRUCTION_KEY[kind] || INSTRUCTION_KEY.short];
  // Read raw rather than through resolveUx: this is printed on paper, and the
  // chat resolver's direction marks have no business on a photocopy.
  return entry[rtl ? 'ur' : 'en'];
}

module.exports = {
  SUBJECT_LABEL, GRADE_BANDS, subjectLabel, taughtIn,
  SHORT_TYPE, shortType, INSTRUCTION_KEY, defaultInstruction,
};
