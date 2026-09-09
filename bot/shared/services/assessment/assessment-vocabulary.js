'use strict';
/**
 * How a grade and a subject are NAMED, in one place.
 *
 * Two small maps that were, until bd-60067, copied verbatim into three files:
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

module.exports = { SUBJECT_LABEL, GRADE_BANDS, subjectLabel, taughtIn };
