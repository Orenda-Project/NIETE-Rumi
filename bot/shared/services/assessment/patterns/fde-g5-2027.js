'use strict';
/**
 * The FDE Grade V Centralised Annual Examination pattern (Feb 2027), as data.
 *
 * One object per subject the generator can set in this pattern. Everything a
 * board-pattern paper is decided by lives here: sections, their time and marks,
 * each question slot (how many items are printed, how many the child answers,
 * marks each), FDE's own printed lines, the scope, and the marking-scheme
 * chrome. The layout pass, the scheme check and the renderer read it; nothing
 * writes it (the whole tree is frozen on load).
 *
 * Printed lines are FDE's words. A count inside a line is an atom `{k:v}`:
 * `v` is the value FDE printed and `k` says what it counts — w the attempt as a
 * word, n the attempt as a number, t attempt × marks (a slot or section total).
 * Strip the braces and you have FDE's line; the renderer recomputes the value
 * when a teacher removes a question, so no printed count is ever typed.
 * Whitespace and the multiplication sign are normalised (FDE prints "x" and
 * "×" on the same page); every other character is as printed.
 *
 * A slot's `words` print on the paper only where `print_words` is true (a word
 * list the child works from); anywhere else they are the key and stay off it.
 *
 * Urdu: lines copied from FDE's pages are marked "transcribed"; every other
 * Urdu line here is a draft and needs fluent-Urdu review before teachers see it.
 * Religious text is never authored: the Naat alternative prints FDE's
 * instruction only and has no key. Islamiat (fde-g5-islamiat.js) leaves every
 * ayat, hadith, dua and durood for the teacher to write, and has no true/false.
 *
 * Data only. Its one require is the Islamiat subject, also data.
 */

const ISLAMIAT = require('./fde-g5-islamiat');
const { BEFORE_EXAM, COMMON_EN, COMMON_UR, FILES, NAME, SUPPLIES, TIME3, WAIT, YOU_ADD, legendFor } = require('./fde-g5-2027/common');
const { ENGLISH } = require('./fde-g5-2027/english');
const { MATHS } = require('./fde-g5-2027/maths');
const { SCIENCE } = require('./fde-g5-2027/science');
const { SST, SUMMARY } = require('./fde-g5-2027/social-studies');
const { URDU } = require('./fde-g5-2027/urdu');

// Islamiat is offered since the engine prints its teacher-filled Q3 and Nazra sheet (bd-5jmnfj.39.1).
const SUBJECTS = { maths: MATHS, science: SCIENCE, english: ENGLISH, urdu: URDU, social_studies: SST, islamiat: ISLAMIAT };
// A subject built and checked but not yet offered goes here; moving it into SUBJECTS makes it eligible.
const HELD_SUBJECTS = {};
for (const [key, subject] of Object.entries({ ...SUBJECTS, ...HELD_SUBJECTS })) {
  const header = {};
  for (const [k, v] of Object.entries(COMMON_EN)) header[`${k}_en`] = v;
  for (const [k, v] of Object.entries(COMMON_UR)) header[`${k}_ur`] = v;
  subject.header = { ...header, ...subject.header };
  subject.legend = legendFor(key);
  subject.before_exam = BEFORE_EXAM;
  subject.supplies = SUPPLIES;
  subject.summary_lines = SUMMARY[key];
}

function deepFreeze(node) {
  if (node && typeof node === 'object' && !Object.isFrozen(node)) {
    Object.freeze(node);
    Object.values(node).forEach(deepFreeze);
  }
  return node;
}

module.exports = deepFreeze({
  id: 'fde_g5_2027',
  grade: 5,
  exam: { name_en: 'FDE Grade V Centralised Annual Examination', session: 'Feb 2027' },
  you_add: YOU_ADD,
  files: FILES,
  name: NAME,
  wait_hint: WAIT,
  total_time: TIME3,
  subjects: SUBJECTS,
  held_subjects: HELD_SUBJECTS,
});
