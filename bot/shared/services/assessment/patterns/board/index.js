'use strict';
/**
 * The G6-12 board patterns (FBISE SSC/HSSC), looked up by id (bd-5jmnfj.38.24).
 *
 * Kept apart from patterns/index.js on purpose: that registry feeds the Flow, browse and the FDE renderer,
 * none of which read a variants[] subject. A board pattern is reachable only by its id, from
 * _writePatternPaper, until the surfaces lane lists it.
 */
const { normalise } = require('../index');

const BOARD = Object.freeze(Object.fromEntries(
  ['fbise-ssc1', 'fbise-ssc2', 'fbise-hssc1', 'fbise-hssc2'].map((f) => {
    const def = require(`./${f}`); // eslint-disable-line global-require, import/no-dynamic-require
    return [def.id, def];
  }),
));

function get(id) {
  return (typeof id === 'string' && BOARD[id]) || null;
}

function isBoard(id) {
  return get(id) !== null;
}

function subjectOf(id, subject) {
  const def = get(id);
  return (def && def.subjects[normalise(subject)]) || null;
}

/** Its own grade only, and only a subject it sets. */
function isEligible(id, grade, subject) {
  const def = get(id);
  return Boolean(def && Number(grade) === def.grade && subjectOf(id, subject));
}

/** Every board pattern id. */
function list() {
  return Object.keys(BOARD);
}

/** The grades a board pattern exists for, ascending (one pattern per grade, registered in grade order). */
function grades() {
  return Object.values(BOARD).map((def) => def.grade);
}

/**
 * The lines the app shows about a board pattern for one subject: the same shape as the FDE
 * patterns' summaryFor, so the Flow reads one shape. Built from the subject's top-level fields,
 * which mirror its first variant (bd-5jmnfj.38.25.1). A board paper frames nothing, so youAdd is null.
 */
function summaryFor(id, subject) {
  const P = get(id);
  const S = subjectOf(id, subject);
  if (!S) return null;
  const slots = S.sections.flatMap((sec) => sec.slots);
  const generateTotal = slots.reduce((sum, slot) => sum + slot.generate, 0);
  const n = S.sections.length;
  const lines = S.summary_lines;
  return {
    id: P.id,
    name: { en: P.name.en, ur: P.name.ur },
    holds: {
      en: `${n} sections · ${S.total_marks} marks · ${S.total_time_en} · ${generateTotal} questions`,
      ur: `${n} حصے · ${S.total_marks} نمبر · ${S.total_time_ur} · ${generateTotal} سوال`, // needs fluent-Urdu review
    },
    sections: S.sections.map((sec, i) => ({ id: sec.id, en: lines.en.sections[i], ur: lines.ur.sections[i] })),
    choice: { en: lines.en.choice, ur: lines.ur.choice },
    choices: slots.filter((slot) => slot.attempt < slot.generate).map((slot) => ({
      slot: slot.slot,
      label_en: slot.label_en,
      label_ur: slot.label_ur,
      generate: slot.generate,
      attempt: slot.attempt,
      marks_each: slot.marks_each,
    })),
    youAdd: null,
    scope: {
      en: S.scope.line_en,
      ur: S.scope.line_ur,
      label: { en: S.scope.label_en, ur: S.scope.label_ur },
      chapters: [...S.scope.chapter_numbers],
      displayChapters: [...S.scope.display_chapters],
      excluded: [...S.scope.excluded],
      topicsOnly: [...S.scope.topics_only],
      held: [...S.scope.held],
      unitRanges: S.scope.unit_ranges.map((u) => ({ chapter: u.chapter, ranges: u.ranges })),
    },
    files: { en: P.files.en, ur: P.files.ur },
    generateTotal,
    totalMarks: S.total_marks,
    totalTime: { en: S.total_time_en, ur: S.total_time_ur },
    waitHint: { en: P.wait_hint.en, ur: P.wait_hint.ur },
  };
}

/**
 * The request row's question_types for a board paper (bd-5jmnfj.38.25.2): one slot-tagged entry per slot, in the
 * FDE expandTypes shape. Read from the subject's top-level sections (its first variant); the writer resolves the
 * variant again at write time, so this is the record of what was asked for.
 */
function expandTypes(id, subject) {
  const S = subjectOf(id, subject);
  if (!S) return [];
  return S.sections.flatMap((sec) => sec.slots).map((slot) => ({
    id: slot.type, count: slot.generate, category: slot.category, slot: slot.slot,
  }));
}

module.exports = { get, isBoard, subjectOf, isEligible, list, grades, summaryFor, expandTypes };
