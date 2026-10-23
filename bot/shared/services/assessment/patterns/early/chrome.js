'use strict';
/**
 * The shared chrome of the Grade 1–2 FDE practice papers: header lines, the
 * teacher's legend, the slot defaults and the frozen pattern object. The
 * subject files hold only what differs per subject (sections, slots, oral).
 *
 * The header, "before the exam" and supplies text are Grade 5's, read from its
 * frozen pattern; only the subject lines are new here.
 *
 * Pure data and pure builders.
 */

const G5 = require('../fde-g5-2027');

const GRADE_WORD = { 1: { en: 'Grade I', ur: 'جماعت اول' }, 2: { en: 'Grade II', ur: 'جماعت دوم' } };

// Grade 5's per-subject lines; everything else in its header is shared chrome.
const OWN_KEYS = /^(title|time_line|total_line|note|covers_partial)_(en|ur)$/;

function commonHeader() {
  const g5 = G5.subjects.english.header;
  const out = {};
  Object.keys(g5).filter((k) => !OWN_KEYS.test(k)).forEach((k) => { out[k] = g5[k]; });
  return out;
}

/** The legend: how to mark, with the oral part named. No grade bands: FDE's G1-2 papers print none. */
function legendFor(key) {
  return {
    title_en: 'How to mark',
    title_ur: 'جانچنے کا طریقہ',
    lines_en: [
      'One mark per correct item unless the paper says otherwise. Spelling is not marked in Maths or GK.',
      '',
      'Written marks only. Record the oral marks from the oral sheet, then add both on the class record.',
    ],
    lines_ur: [
      'جب تک پرچے میں کچھ اور نہ لکھا ہو، ہر درست جواب پر 1 نمبر۔ ریاضی اور معلومات عامہ میں املا کے نمبر نہیں کٹتے۔',
      '',
      'یہ صرف تحریری نمبر ہیں۔ زبانی نمبر زبانی جائزے کی شیٹ سے لکھیں، پھر کلاس ریکارڈ پر دونوں جمع کریں۔',
    ],
    bands_line: -1,
    bands_lead_ur: '',
    key_line: 1,
    maths_lines: [],
    key_names_en: { M: 'method', A: 'answer', U: 'unit', K: 'key point', L: 'label' },
    key_names_ur: { M: 'طریقہ', A: 'جواب', U: 'اکائی', K: 'اہم نکتہ', L: 'نام' },
    subject: key,
    key_from_chips: true,
  };
}

/** One slot in Grade 5's shape, with the early-paper defaults. `picture` names the kinds an item must draw. */
function makeSlot(o) {
  const attempt = o.attempt == null ? o.generate : o.attempt;
  const total = attempt * o.marks_each;
  const mcq = o.shape === 'mcq';
  return {
    slot: o.slot,
    label_en: o.label_en,
    label_ur: o.label_ur || String(o.label_en).replace(/^Q(\d+)\.?$/, 'سوال $1'),
    instruction_en: o.instruction_en || null,
    instruction_ur: o.instruction_ur || null,
    marks_line_en: `({t:${total}})`,
    marks_line_ur: `{t:${total}}`,
    type: o.type,
    category: mcq || o.objective ? 'objective' : 'subjective',
    shape: o.shape || 'short',
    generate: o.generate,
    attempt,
    marks_each: o.marks_each,
    parts: null,
    numbering: o.numbering || 'roman',
    ...(mcq ? { option_labels: o.option_labels || 'a' } : {}),
    compulsory: true,
    lines: o.lines == null ? 1 : o.lines,
    work_mm: o.work_mm || null,
    section_pages: 'scope',
    grain: null,
    families: null,
    kinds: null,
    prompt_rule: o.prompt_rule,
    frame: null,
    teacher_note_en: null,
    teacher_note_ur: null,
    alternatives: null,
    or: false,
    picture: o.picture || null,
    answer_box: true,
    picture_only: Boolean(o.picture_only),
    print_words: Boolean(o.print_words),
    answer_ok: o.answer_ok || null,
  };
}

function slotTotal(s) {
  return s.attempt * s.marks_each;
}

function makeSection(o) {
  const slots = o.slots.map(makeSlot);
  const marks = slots.reduce((n, s) => n + slotTotal(s), 0);
  return {
    id: o.id,
    time_en: null,
    label_en: o.label_en,
    label_ur: o.label_ur || null,
    marks_en: `Total Marks: {t:${marks}}`,
    marks_ur: `کل نمبر: {t:${marks}}`,
    marks,
    levels: o.levels,
    answer_on: 'question_paper',
    note_en: null,
    slots,
  };
}

const ORAL_DEFAULT = {
  title_en: 'Oral assessment · teacher sheet',
  title_ur: 'زبانی جائزہ · استاد کی شیٹ',
  note_en: 'Take the oral part one child at a time, before or after the written paper. Read the script aloud as written.',
  note_ur: 'زبانی حصہ ہر بچے سے الگ الگ لیں، تحریری پرچے سے پہلے یا بعد میں۔ اسکرپٹ لکھے ہوئے الفاظ میں پڑھ کر سنائیں۔',
};

/**
 * How a task's rubric is read: 'each' (one row, marks per item), 'criteria' (rows add up to
 * the task) or 'bands' (pick one row; the top row is the task). Anything else is a data error.
 */
function scoringOf(t) {
  const marks = t.rubric.map((r) => r.marks);
  if (marks.length === 1 && t.marks % marks[0] === 0) return 'each';
  if (marks.reduce((a, b) => a + b, 0) === t.marks) return 'criteria';
  if (Math.max(...marks) === t.marks && marks.includes(0)) return 'bands';
  throw new Error(`oral task ${t.id}: rubric does not add up to ${t.marks}`);
}

function makeOral(o) {
  if (!o) return null;
  const tasks = o.tasks.map((t) => ({ ...t, scoring: scoringOf(t) }));
  const marks = tasks.reduce((n, t) => n + t.marks, 0);
  return { ...ORAL_DEFAULT, ...o, tasks, marks };
}

/** One subject: totals from its slots, whole-book scope, summary lines from its sections. */
function makeSubject({ grade, key, medium, name_en, name_ur, tos, pages, sections, oral }) {
  const built = sections.map(makeSection);
  const total = built.reduce((n, s) => n + s.marks, 0);
  const orals = makeOral(oral);
  const g = GRADE_WORD[grade];
  const all = orals ? total + orals.marks : total;
  const range = `1-${pages}`;
  return {
    key, medium, name_en, name_ur,
    total_marks: total,
    oral_marks: orals ? orals.marks : 0,
    tos,
    total_time_en: 'as the school sets',
    total_time_ur: 'اسکول کے مطابق',
    header: {
      ...commonHeader(grade),
      title_en: `${g.en} · ${name_en} · FDE pattern practice paper`,
      title_ur: `${g.ur} · ${name_ur} · FDE pattern کا مشقی پرچہ`,
      time_line_en: '',
      time_line_ur: '',
      total_line_en: `Written Marks: {t:${total}}`,
      total_line_ur: `تحریری نمبر: {t:${total}}`,
      note_en: orals ? `Written ${total} + oral ${orals.marks} = ${all} marks. The oral part is taken by the teacher from the marking scheme.` : null,
      note_ur: orals ? `تحریری ${total} + زبانی ${orals.marks} = ${all} نمبر۔ زبانی حصہ استاد مارکنگ اسکیم سے لیں گے۔` : null,
      covers_partial_en: 'Covers {units}.',
      covers_partial_ur: 'احاطہ: {units}۔',
    },
    scope: {
      page_ranges: range,
      chapter_numbers: [],
      display_chapters: [],
      excluded: [],
      topics_only: [],
      held: [],
      unit_ranges: [],
      label_en: 'Whole book',
      label_ur: 'پوری کتاب',
      line_en: `The whole ${name_en} book (pages ${range}).`,
      line_ur: `${name_ur} کی پوری کتاب (صفحات ${range})۔`,
    },
    sections: built,
    oral: orals,
    legend: legendFor(key),
    before_exam: G5.subjects.english.before_exam,
    supplies: G5.subjects.english.supplies,
    summary_lines: {
      en: { sections: built.map((s) => `${s.marks} · ${s.label_en}`), choice: orals ? `+ oral ${orals.marks}` : '' },
      ur: { sections: built.map((s) => `${s.marks} · ${s.label_ur || s.label_en}`), choice: orals ? `+ زبانی ${orals.marks}` : '' },
    },
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
  return deepFreeze({
    id,
    grade,
    profile: 'early',
    exam: { name_en: `FDE ${GRADE_WORD[grade].en} Annual Assessment`, session: 'Nov 2026' },
    you_add: G5.you_add,
    files: G5.files,
    name: G5.name,
    wait_hint: G5.wait_hint,
    total_time: null,
    subjects: Object.fromEntries(subjects.map((s) => [s.key, s])),
  });
}

module.exports = { build, makeSubject, makeSection, makeSlot, legendFor, commonHeader, GRADE_WORD };
