'use strict';
/**
 * The shared chrome of the G6-12 board patterns (SPEC §4): slot, section, variant and subject builders that
 * compute what a slot generates and is worth, refuse arithmetic that disagrees with a declared total
 * (BLUEPRINTS B5), and the frozen pattern object (`profile: 'board'`). Board header lines live beside this
 * file, one module per board (`fde-chrome.js`; `fbise-chrome.js` from b-patterns-fbise adds one BOARDS line).
 *
 * Marks are checked in ×4 integers so FBISE's ½ and ¾ never drift (P2). Never requires the G5 pattern or the
 * mid chrome. Pure data and pure builders; `validate.js` re-checks the built result independently.
 */

const { GRADE_WORD, timeEn, timeUr } = require('./words');
const BOARDS = { FDE: require('./fde-chrome'), FBISE: require('./fbise-chrome') };

// The closed slot-type enum (contracts/types/question-types-6-12.json, minus the pseudo-type board_paper).
const OBJECTIVE = ['mcq', 'scenario', 'fill_blank', 'true_false_correct', 'match', 'sequence'];
const SUBJECTIVE = ['srq', 'erq', 'translation', 'quran_passage', 'comprehension', 'grammar', 'precis', 'explanation_prose',
  'explanation_poem', 'explanation_ghazal', 'letter', 'essay', 'activity_written', 'dialogue', 'programme', 'map_free_geo'];
const TYPES = Object.freeze(Object.fromEntries([
  ...OBJECTIVE.map((t) => [t, 'objective']), ...SUBJECTIVE.map((t) => [t, 'subjective']), ['practical', 'out_of_exam'],
]));
const ANSWER_ON = ['question_paper', 'omr', 'e_sheet'];
const STYLES = ['holistic_bands', 'analytic_points'];
const SPLIT_STATUS = ['verified', 'derived', 'default', 'design_pending'];
const LEVEL_SETS = [['R', 'U', 'A', 'AE', 'C'], ['K', 'U', 'A']];
const STIMULUS_KINDS = ['passage', 'table', 'graph-free', 'scenario'];
const SUBJECT_STATUS = ['ship', 'ship_derived'];

const x4 = (m) => Math.round(m * 4);
const isQuarter = (m) => typeof m === 'number' && m > 0 && Math.abs(m * 4 - x4(m)) < 1e-9;
const posInt = (n) => Number.isInteger(n) && n > 0;
function fail(where, msg) { throw new Error(`board pattern ${where}: ${msg}`); }

function checkStimulus(where, st) {
  if (st == null) return null;
  if (!posInt(st.count) || !posInt(st.mcqs_per_stimulus) || !(st.kinds || []).every((k) => STIMULUS_KINDS.includes(k))) {
    fail(where, 'stimulus needs count, mcqs_per_stimulus and text-only kinds (P3)');
  }
  return st;
}

function orOf(where, or) {
  const br = or.branches || [];
  if (br.length < 2) fail(where, 'an OR slot needs two or more branches');
  br.forEach((b) => { if (!TYPES[b.type]) fail(where, `unknown type ${b.type}`); });
  if (!br.every((b) => b.marks_each === br[0].marks_each)) fail(where, 'OR branches must carry equal marks');
  return { branches: br.map((b) => ({ type: b.type, marks_each: b.marks_each, generate: 1 })) };
}

/** One slot. `or` = internal choice (P5); `project` = teacher-marked, no items (R14, P6). */
function makeSlot(o) {
  const where = `slot ${o.slot}`;
  if (!o.slot) fail('slot', 'slot id is required');
  if (!o.label_en) fail(where, 'label_en is required');
  const or = o.or ? orOf(where, o.or) : null;
  const project = o.project ? { marks: o.project.marks, instruction_en: o.project.instruction_en, instruction_ur: o.project.instruction_ur || null, teacher_marked: true } : null;
  if (project && !project.instruction_en) fail(where, 'a teacher-marked slot needs its instruction line');
  const type = project ? 'practical' : or ? or.branches[0].type : o.type;
  if (!TYPES[type]) fail(where, `unknown type ${type}`);
  const printed = or ? or.branches.length : project ? 1 : (o.printed == null ? 1 : o.printed);
  if (!posInt(printed)) fail(where, `printed must be a whole number, got ${printed}`);
  const attempt = or || project ? 1 : (o.attempt == null ? printed : o.attempt);
  if (!posInt(attempt) || attempt > printed) fail(where, `attempt ${attempt} must be 1..${printed}`);
  const marksEach = project ? project.marks : or ? or.branches[0].marks_each : o.marks_each;
  if (!(marksEach > 0)) fail(where, `marks_each must be positive, got ${marksEach}`);
  if (!isQuarter(marksEach)) fail(where, `marks_each ${marksEach} is not a whole quarter mark`);
  if (o.parts && o.parts.reduce((n, p) => n + p, 0) !== marksEach) fail(where, `parts ${o.parts} do not add up to ${marksEach}`);
  const marks = attempt * marksEach;
  const each = attempt > 1;
  return {
    slot: o.slot,
    label_en: o.label_en,
    label_ur: o.label_ur || String(o.label_en).replace(/^Q\.?\s?(\d+)\.?$/, 'سوال $1'),
    type,
    category: TYPES[type],
    printed,
    attempt,
    generate: project ? 0 : printed,
    marks_each: marksEach,
    marks,
    marks_x4: x4(marksEach),
    total_x4: x4(marks),
    instruction_en: o.instruction_en || (type === 'mcq' ? 'Encircle the correct option.' : attempt < printed ? `Attempt any {n:${attempt}} questions.` : null),
    instruction_ur: o.instruction_ur || null,
    marks_line_en: each ? `({n:${attempt}} × ${marksEach} = {t:${marks}})` : `({t:${marks}})`,
    marks_line_ur: each ? `{n:${attempt}} × ${marksEach} = {t:${marks}}` : `{t:${marks}}`,
    parts: o.parts || null,
    or,
    project,
    teacher_marked: Boolean(project),
    stimulus: checkStimulus(where, o.stimulus),
    slo_code_prefix: o.slo_code_prefix || null,
    level_policy: o.level_policy || null,
    prompt_rule: o.prompt_rule || null,
    deviation: o.deviation || null,
    section_pages: 'scope',
    frame: null,
    compulsory: attempt === printed && !or,
  };
}

function makeSection(o) {
  const where = `section ${o.id}`;
  if (!o.slots || o.slots.length === 0) fail(where, 'needs slots');
  const answerOn = o.answer_on || 'e_sheet';
  if (!ANSWER_ON.includes(answerOn)) fail(where, `unknown answer_on ${answerOn}`);
  const slots = o.slots.map(makeSlot);
  const ids = slots.map((s) => s.slot);
  if (new Set(ids).size !== ids.length) fail(where, 'duplicate slot id');
  const total4 = slots.reduce((n, s) => n + s.total_x4, 0);
  if (o.marks != null && x4(o.marks) !== total4) fail(where, `slots add up to ${total4 / 4}, not the declared ${o.marks}`);
  return {
    id: o.id, label_en: o.label_en, label_ur: o.label_ur || null, time_min: o.time_min == null ? null : o.time_min,
    answer_on: answerOn, marks: total4 / 4, marks_x4: total4, marks_en: `Total Marks: {t:${total4 / 4}}`,
    marks_ur: `کل نمبر: {t:${total4 / 4}}`, note_en: o.note_en || null, note_ur: o.note_ur || null, slots,
  };
}

function checkSplit(cs) {
  const keys = Object.keys(cs.levels || {});
  if (!LEVEL_SETS.some((set) => keys.every((k) => set.includes(k)))) fail('split', `unknown level in ${keys}`);
  const sum = keys.reduce((n, k) => n + cs.levels[k], 0);
  if (sum !== 100) fail('split', `levels must sum to 100, got ${sum}`);
  if (!SPLIT_STATUS.includes(cs.status)) fail('split', `unknown status ${cs.status}`);
  return { tolerance_pp: 5, ...cs };
}

function makeVariant(o) {
  const where = `variant ${o.variant_id || 'default'}`;
  if (!o.sections || o.sections.length === 0) fail(where, 'needs sections');
  if (!STYLES.includes(o.scheme_style)) fail(where, `unknown scheme_style ${o.scheme_style}`);
  const sections = o.sections.map(makeSection);
  const shared = o.shared_sections || [];
  if (shared.some((id) => sections.find((s) => s.id === id).time_min != null)) fail(where, 'shared sections print no time of their own (P10)');
  const all = sections.flatMap((s) => s.slots);
  const total4 = sections.reduce((n, s) => n + s.marks_x4, 0);
  if (x4(o.total_marks) !== total4) fail(where, `sections add up to ${total4 / 4}, not the declared ${o.total_marks}`);
  const tm4 = all.filter((s) => s.teacher_marked).reduce((n, s) => n + s.total_x4, 0);
  const mcq4 = all.filter((s) => s.type === 'mcq').reduce((n, s) => n + s.total_x4, 0);
  return {
    variant_id: o.variant_id || 'default', applies_to: o.applies_to || { sessions: ['*'] },
    label_en: o.label_en || null, label_ur: o.label_ur || null,
    total_marks: total4 / 4, generated_marks: (total4 - tm4) / 4, teacher_marked_marks: tm4 / 4,
    mcq_share_x100: Math.round((10000 * mcq4) / total4),
    total_time_min: o.total_time_min == null ? null : o.total_time_min,
    shared_time_min: o.shared_time_min == null ? null : o.shared_time_min, shared_sections: shared,
    cognitive_split: checkSplit(o.cognitive_split), scheme_style: o.scheme_style, exam_header: o.exam_header || null, sections,
  };
}

function makeSubject(o) {
  const where = `subject ${o.key}`;
  if (!['en', 'ur'].includes(o.medium)) fail(where, `unknown medium ${o.medium}`);
  if (!o.source_id) fail(where, 'source_id (the patterns_g6_12.json id) is required');
  if (!SUBJECT_STATUS.includes(o.status)) fail(where, `unknown status ${o.status}`);
  if (o.status === 'ship_derived' && !o.derivation) fail(where, 'a ship_derived subject needs its derivation note');
  if (!o.variants || o.variants.length === 0) fail(where, 'needs variants');
  return {
    key: o.key, source_id: o.source_id, medium: o.medium, name_en: o.name_en, name_ur: o.name_ur, status: o.status,
    derivation: o.derivation || null, deviations: o.deviations || [], notes: o.notes || null,
    variants: o.variants.map(makeVariant),
  };
}

function pendingCell(o) {
  if (!o.reason) fail(`pending ${o.key}`, 'a pending cell names its reason');
  return { key: o.key, source_id: o.source_id || null, medium: o.medium, status: 'design_pending', reason: o.reason };
}

const SCOPE = {
  page_ranges: '', chapter_numbers: [], display_chapters: [], excluded: [], topics_only: [], held: [], unit_ranges: [],
  label_en: 'Chosen chapters', label_ur: 'منتخب ابواب', // needs fluent-Urdu review
  line_en: 'The chapters or pages the teacher chose.', line_ur: 'استاد کے منتخب کردہ ابواب یا صفحات۔', // needs fluent-Urdu review
};

function summaryLines(V) {
  const choices = V.sections.flatMap((s) => s.slots).filter((s) => s.attempt < s.printed);
  const line = (s) => [timeEn(s.time_min), String(s.marks), s.label_en].filter(Boolean).join(' · ');
  const lineUr = (s) => [timeUr(s.time_min), String(s.marks), s.label_ur || s.label_en].filter(Boolean).join(' · ');
  return {
    en: { sections: V.sections.map(line), choice: choices.map((s) => `${s.label_en.replace(/^Q\.\s?/, 'Q')}: attempt any ${s.attempt} of ${s.printed} · ${s.marks_each} each`).join('; ') },
    ur: { sections: V.sections.map(lineUr), choice: choices.map((s) => `${s.label_ur}: ${s.printed} میں سے کوئی سے ${s.attempt} · ہر ایک ${s.marks_each}`).join('؛ ') }, // needs fluent-Urdu review
  };
}

/** Board chrome on a built subject: header, exam header, legend, summary and the G5-compatible mirrors. */
function dress(chrome, grade, examKind, S) {
  const variants = S.variants.map((v) => ({ ...v, exam_header: v.exam_header || chrome.examHeader(grade, examKind, S, v) }));
  const V = variants[0];
  return {
    ...S, grade, variants, g5_rules: false, oral: null, oral_marks: 0,
    total_marks: V.total_marks, sections: V.sections,
    total_time_en: timeEn(V.total_time_min) || 'as the school sets', total_time_ur: timeUr(V.total_time_min) || 'اسکول کے مطابق',
    header: chrome.header(grade, examKind, S, V), scope: SCOPE, legend: chrome.legendFor(S.key, V.scheme_style),
    summary_lines: summaryLines(V),
  };
}

function deepFreeze(node) {
  if (node && typeof node === 'object' && !Object.isFrozen(node)) {
    Object.freeze(node);
    Object.values(node).forEach(deepFreeze);
  }
  return node;
}

function build({ id, grade, board, exam_kind: examKind, subjects, pending = [] }) {
  const chrome = BOARDS[board];
  if (!chrome) fail(id, `unknown board ${board}`);
  if (!GRADE_WORD[grade]) fail(id, `grade 6-12 only, got ${grade}`);
  if (!chrome.EXAM_KINDS.includes(examKind)) fail(id, `unknown exam_kind ${examKind}`);
  const keys = [...subjects, ...pending].map((s) => s.key);
  if (new Set(keys).size !== keys.length) fail(id, 'a subject key appears twice');
  return deepFreeze({
    id, grade, board, profile: 'board', exam_kind: examKind,
    exam: { name_en: chrome.examName(grade, examKind), session: chrome.SESSION },
    you_add: {}, files: chrome.FILES, name: chrome.NAME, wait_hint: chrome.WAIT, total_time: null,
    subjects: Object.fromEntries(subjects.map((s) => [s.key, dress(chrome, grade, examKind, s)])),
    pending: Object.fromEntries(pending.map((p) => [p.key, p])),
  });
}

module.exports = {
  build, makeSubject, makeVariant, makeSection, makeSlot, pendingCell, timeEn, timeUr,
  GRADE_WORD, TYPES, ANSWER_ON, STYLES, SPLIT_STATUS, LEVEL_SETS, STIMULUS_KINDS, SUBJECT_STATUS, BOARDS,
};
