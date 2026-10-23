'use strict';

/**
 * How a classroom is named to a coach or teacher (R1 §7.1, §7.3): the roster's own label, the words
 * teachers already see in /roster and attendance.
 *
 *   section          "Grade 3 - B"            · ur "جماعت سوم - B"
 *   evening class    "Grade 3 - B (evening)"  · ur "جماعت سوم - B (شام)"
 *   no section, the grade's only class          "Grade 3"
 *   no section, beside lettered classes         "Grade 3 (no section)"
 *   short form (after the first mention)        "3-B", "3"
 *
 * Grade and shift words come from the catalog's label maps (gradeLabelFor / shiftLabelFor); a section
 * is its own code in both languages (A–O).
 */

const { gradeLabelFor, shiftLabelFor, resolveUx } = require('../../../config/ux-strings');

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const shiftOf = (c) => (clean(c && (c.shift_code || c.shift)) || 'morning');

function gradeNumber(c) {
  const n = Number(String((c && (c.grade_code || c.grade)) ?? '').replace(/^grade_/, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** One language's long label. `noSectionSiblings`: the grade has other classes beside this unsectioned one. */
function labelIn(lang, c, { noSectionSiblings = false } = {}) {
  const grade = gradeNumber(c);
  if (!grade) return null;
  let label = gradeLabelFor(`grade_${grade}`, lang) || `Grade ${grade}`;
  const section = clean(c.section);
  if (section) label = `${label} - ${section}`;
  else if (noSectionSiblings) label = `${label} (${resolveUx('childTestNoSection', { language: lang })})`;
  const shift = shiftOf(c);
  if (shift !== 'morning') {
    const word = shiftLabelFor(shift, lang) || shift;
    label = `${label} (${lang === 'en' ? word.toLowerCase() : word})`;
  }
  return label;
}

/**
 * @param {{grade_code?: string, grade?: number, section?: string|null, shift_code?: string, shift?: string}} c
 * @returns {{classLabel: string|null, classLabelUr: string|null, classShort: string|null}}
 */
function classLabels(c, opts = {}) {
  const grade = gradeNumber(c);
  const section = clean(c && c.section);
  return {
    classLabel: labelIn('en', c || {}, opts),
    classLabelUr: labelIn('ur', c || {}, opts),
    classShort: grade ? (section ? `${grade}-${section}` : String(grade)) : null,
  };
}

module.exports = { classLabels, shiftOf, gradeNumber };
