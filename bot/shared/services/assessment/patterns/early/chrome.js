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

// The spelling line is for Maths and GK keys only: a language key marks spelling (bd-5jmnfj.4.50.5).
const NO_SPELLING = ['maths', 'general_knowledge'];
const SPELLING = {
  en: ' Spelling is not marked unless the key says so.',
  ur: ' املا کے نمبر صرف وہاں کٹتے ہیں جہاں کلید میں لکھا ہو۔', // needs fluent-Urdu review
};

/** The legend: how to mark, with the oral part named only when the paper has one. No grade bands: FDE's G1-2 papers print none. */
function legendFor(key, hasOral = true) {
  const spelling = (lang) => (NO_SPELLING.includes(key) ? SPELLING[lang] : '');
  return {
    title_en: 'How to mark',
    title_ur: 'جانچنے کا طریقہ',
    lines_en: [
      `One mark per correct item unless the paper says otherwise.${spelling('en')}`,
      '',
      ...(hasOral ? ['Written marks only. Record the oral marks from the oral sheet, then add both on the class record.'] : []),
    ],
    lines_ur: [
      `جب تک پرچے میں کچھ اور نہ لکھا ہو، ہر درست جواب پر 1 نمبر۔${spelling('ur')}`,
      '',
      ...(hasOral ? ['یہ صرف تحریری نمبر ہیں۔ زبانی نمبر زبانی جائزے کی شیٹ سے لکھیں، پھر کلاس ریکارڈ پر دونوں جمع کریں۔'] : []),
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

// v27 G1 English Q12 i drew an egg whose outline read as a stone, and small objects sat lost at the back of their
// scenes (bd-5jmnfj.4.58.3). Every picture slot carries the one rule for what a plain outline can show.
const PICTURE_RULE = ' The picture is a plain black-outline drawing a child names at once: never a thing whose outline alone is '
  + 'unreadable (egg, ball, plate, cup, watch, bench, box). A small object placed in a scene is drawn large and in front.';

/** One slot in Grade 5's shape, with the early-paper defaults. `picture` names the kinds an item must draw. */
function makeSlot(o) {
  const attempt = o.attempt == null ? o.generate : o.attempt;
  const total = attempt * o.marks_each;
  const mcq = o.shape === 'mcq';
  const each = attempt > 1 && o.marks_each > 1;
  return {
    slot: o.slot,
    label_en: o.label_en,
    label_ur: o.label_ur || String(o.label_en).replace(/^Q(\d+)\.?$/, 'سوال $1'),
    instruction_en: o.instruction_en || null,
    instruction_ur: o.instruction_ur || null,
    // Items worth 2 or more print their sum under a one-mark legend (bd-5jmnfj.4.57): "(5×2=10)".
    marks_line_en: each ? `({n:${attempt}}×${o.marks_each}={t:${total}})` : `({t:${total}})`,
    marks_line_ur: each ? `{n:${attempt}}×${o.marks_each}={t:${total}}` : `{t:${total}}`,
    type: o.type,
    category: mcq || o.shape === 'match' || o.objective ? 'objective' : 'subjective',
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
    prompt_rule: o.picture ? `${o.prompt_rule || ''}${PICTURE_RULE}` : o.prompt_rule,
    frame: null,
    teacher_note_en: null,
    teacher_note_ur: null,
    alternatives: null,
    or: false,
    picture: o.picture || null,
    answer_box: true,
    picture_only: Boolean(o.picture_only),
    sentence_box: Boolean(o.sentence_box),
    print_words: Boolean(o.print_words),
    bubble: Boolean(o.bubble),
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
  note_en: 'Take the oral part after the written paper, one child at a time. Read the script aloud as written.',
  note_ur: 'زبانی حصہ تحریری پرچے کے بعد، ہر بچے سے الگ الگ لیں۔ اسکرپٹ لکھے ہوئے الفاظ میں پڑھ کر سنائیں۔',
};

/**
 * How a task's rubric is read: 'each' (one row, marks per item), 'criteria' (rows add up to
 * the task) or 'bands' (pick one row; the top row is the task). Anything else is a data error.
 */
function scoringOf(t) {
  const marks = t.rubric.map((r) => r.marks);
  if (marks.length === 1 && marks[0] === t.marks && t.n !== t.marks) return 'criteria';
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
    legend: legendFor(key, Boolean(orals)),
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

module.exports = { build, makeSubject, makeSection, makeSlot, makeOral, legendFor, commonHeader, GRADE_WORD };
