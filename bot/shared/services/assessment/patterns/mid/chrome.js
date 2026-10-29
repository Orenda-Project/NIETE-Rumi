'use strict';
/**
 * The shared chrome of the Grade 3–4 FDE end-of-chapter papers (bd-5jmnfj.33.1): slot and
 * section builders with a word-problem count, the chapter-driven scope and the frozen pattern
 * object. Reuses the early builders; sets NO `profile`, so `_writePatternPaper` takes the
 * scoped (Grade 5 style) path that honours chapters and pages.
 *
 * Pure data and pure builders.
 */

const E = require('../early/chrome');
const G5 = require('../fde-g5-2027');
const { midKeyNames } = require('../../fde-mid-legend');

const GRADE_WORD = { 3: { en: 'Grade III', ur: 'جماعت سوم' }, 4: { en: 'Grade IV', ur: 'جماعت چہارم' } };

function gradeWord(grade) {
  const g = GRADE_WORD[grade];
  if (!g) throw new Error(`mid pattern: grade 3 or 4 only, got ${grade}`);
  return g;
}

/** Early slot plus `word_problems`: how many of the slot's generated items are word problems. */
function makeSlot(o) {
  const wp = o.word_problems == null ? 0 : o.word_problems;
  if (!Number.isInteger(wp) || wp < 0) throw new Error(`slot ${o.slot}: word_problems must be a whole number, got ${wp}`);
  if (wp > o.generate) throw new Error(`slot ${o.slot}: word_problems ${wp} is more than generate ${o.generate}`);
  return { ...E.makeSlot(o), word_problems: wp };
}

/** Early section from the same options; each slot is the mid slot, so word_problems survives. */
function makeSection(o) {
  const sec = E.makeSection(o);
  return { ...sec, slots: o.slots.map(makeSlot) };
}

function checkTos(tos) {
  if (tos === undefined) throw new Error('mid pattern: tos is required (null if the paper has none)');
  if (tos === null) return;
  const sum = ['Remember', 'Understand', 'Apply'].reduce((n, k) => n + (typeof tos[k] === 'number' ? tos[k] : NaN), 0);
  if (!Number.isFinite(sum)) throw new Error('mid pattern: tos needs Remember, Understand and Apply');
  if (sum !== 100) throw new Error(`mid pattern: tos must sum to 100, got ${sum}`);
}

function makeSubject({ grade, key, medium, name_en, name_ur, tos, sections, word_problem_cap = null }) {
  const g = gradeWord(grade);
  checkTos(tos);
  const built = sections.map(makeSection);
  const total = built.reduce((n, s) => n + s.marks, 0);
  return {
    key, medium, name_en, name_ur, grade,
    g5_rules: false, // tells the generator to skip the Grade-5-only prompt rules
    total_marks: total,
    oral_marks: 0,
    tos,
    total_time_en: 'as the school sets',
    total_time_ur: 'اسکول کے مطابق',
    header: {
      ...E.commonHeader(grade),
      // No "(FDE pattern)" machine label on a paper a child reads (v30 review, bd-5jmnfj.33.2).
      title_en: `${g.en} · ${name_en} · End-of-chapter paper`,
      title_ur: `${g.ur} · ${name_ur} · باب کے اختتام کا پرچہ`,
      time_line_en: '',
      time_line_ur: '',
      total_line_en: `Total Marks: {t:${total}}`,
      total_line_ur: `کل نمبر: {t:${total}}`,
      note_en: null,
      note_ur: null,
      covers_partial_en: 'Covers {units}.',
      covers_partial_ur: 'احاطہ: {units}۔',
    },
    scope: {
      page_ranges: '',
      chapter_numbers: [],
      display_chapters: [],
      excluded: [],
      topics_only: [],
      held: [],
      unit_ranges: [],
      label_en: 'Chosen chapter',
      label_ur: 'منتخب باب',
      line_en: 'The chapter or pages the teacher chose.',
      line_ur: 'استاد کے منتخب کردہ باب یا صفحات۔',
    },
    sections: built,
    oral: null,
    legend: { ...E.legendFor(key, false), ...midKeyNames(key) },
    before_exam: G5.subjects.english.before_exam,
    supplies: G5.subjects.english.supplies,
    summary_lines: {
      en: { sections: built.map((s) => `${s.marks} · ${s.label_en}`), choice: '' },
      ur: { sections: built.map((s) => `${s.marks} · ${s.label_ur || s.label_en}`), choice: '' },
    },
    word_problem_cap,
  };
}

function deepFreeze(node) {
  if (node && typeof node === 'object' && !Object.isFrozen(node)) {
    Object.freeze(node);
    Object.values(node).forEach(deepFreeze);
  }
  return node;
}

function build({ id, grade, subjects }) {
  const g = gradeWord(grade);
  return deepFreeze({
    id,
    grade,
    exam: { name_en: `FDE ${g.en} end-of-chapter paper (2023-24 model-paper pattern)`, session: '2026-27' },
    you_add: G5.you_add,
    files: G5.files,
    name: G5.name,
    wait_hint: G5.wait_hint,
    total_time: null,
    subjects: Object.fromEntries(subjects.map((s) => [s.key, s])),
  });
}

module.exports = { build, makeSubject, makeSection, makeSlot, GRADE_WORD };
