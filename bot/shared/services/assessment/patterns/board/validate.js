'use strict';
/**
 * The board pattern schema as code (SPEC §4). `validatePattern(P)` re-checks a BUILT pattern independently of
 * the builders in chrome.js (it shares only the closed enums), so a builder bug or a hand edit to a frozen
 * entry is caught. Returns a list of error strings; [] means valid. Marks compare as ×4 integers.
 */
const { TYPES, ANSWER_ON, STYLES, SPLIT_STATUS, LEVEL_SETS, STIMULUS_KINDS, SUBJECT_STATUS } = require('./chrome');

const x4 = (m) => Math.round(m * 4);
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isQuarter = (m) => isNum(m) && m > 0 && Math.abs(m * 4 - x4(m)) < 1e-9;
const isPosInt = (n) => Number.isInteger(n) && n > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const dupes = (ids) => ids.filter((id, i) => ids.indexOf(id) !== i);

function checkStimulus(st, at, err) {
  if (st == null) return;
  if (!isPosInt(st.count) || !isPosInt(st.mcqs_per_stimulus)) err(`${at}: stimulus needs whole count and mcqs_per_stimulus`);
  if (!Array.isArray(st.kinds) || !st.kinds.every((k) => STIMULUS_KINDS.includes(k))) err(`${at}: stimulus kinds must be text-only (${STIMULUS_KINDS.join(', ')})`);
}

function checkOr(s, at, err) {
  const br = (s.or && s.or.branches) || [];
  if (br.length < 2) err(`${at}: an OR slot needs two or more branches`);
  br.forEach((b) => {
    if (!TYPES[b.type]) err(`${at}: unknown branch type ${b.type}`);
    if (b.generate !== 1) err(`${at}: each branch generates 1`);
  });
  if (!br.every((b) => b.marks_each === br[0].marks_each)) err(`${at}: OR branch marks differ`);
  if (br.length && br[0].marks_each !== s.marks_each) err(`${at}: OR branch marks differ from the slot's marks_each`);
  if (s.attempt !== 1) err(`${at}: an OR slot attempts 1`);
}

function checkSlot(s, sec, err) {
  const at = `slot ${s.slot}`;
  if (!s.slot) err(`section ${sec.id}: a slot has no id`);
  if (!TYPES[s.type]) err(`${at}: unknown type ${s.type}`);
  if (!isPosInt(s.printed)) err(`${at}: printed must be a whole number`);
  if (!isPosInt(s.attempt) || s.attempt > s.printed) err(`${at}: attempt ${s.attempt} must be 1..${s.printed}`);
  if (!isQuarter(s.marks_each)) err(`${at}: marks_each ${s.marks_each} is not a positive quarter mark`);
  if (x4(s.marks) !== s.attempt * x4(s.marks_each)) err(`${at}: marks ${s.marks} is not attempt × marks_each`);
  if (s.total_x4 !== s.attempt * x4(s.marks_each)) err(`${at}: total_x4 ${s.total_x4} is not attempt × marks_each ×4`);
  if (s.marks_x4 !== x4(s.marks_each)) err(`${at}: marks_x4 ${s.marks_x4} is not marks_each ×4`);
  if (Array.isArray(s.parts) && x4(s.parts.reduce((n, p) => n + p, 0)) !== x4(s.marks_each)) err(`${at}: parts do not add up to marks_each`);
  if (s.teacher_marked) {
    if (s.generate !== 0) err(`${at}: a teacher-marked slot generates nothing`);
    if (!s.project || !s.project.instruction_en) err(`${at}: a teacher-marked slot needs its instruction line`);
    if (s.type !== 'practical') err(`${at}: a teacher-marked slot has type practical`);
  } else if (s.generate !== s.printed) {
    err(`${at}: generate ${s.generate} must equal printed ${s.printed}`);
  }
  if (s.or) checkOr(s, at, err);
  checkStimulus(s.stimulus, at, err);
}

function checkTime(min, at, err) {
  if (min != null && !isPosInt(min)) err(`${at}: time_min must be a positive whole number or null, got ${min}`);
}

function checkSection(sec, err) {
  const at = `section ${sec.id}`;
  if (!sec.id) err('a section has no id');
  if (!ANSWER_ON.includes(sec.answer_on)) err(`${at}: unknown answer_on ${sec.answer_on}`);
  checkTime(sec.time_min, at, err);
  const slots = Array.isArray(sec.slots) ? sec.slots : [];
  if (slots.length === 0) err(`${at}: needs slots`);
  slots.forEach((s) => checkSlot(s, sec, err));
  const sum = slots.reduce((n, s) => n + (isNum(s.total_x4) ? s.total_x4 : 0), 0);
  if (sec.marks_x4 !== sum) err(`${at}: marks_x4 ${sec.marks_x4} but slots add up to ${sum}`);
  if (x4(sec.marks) !== sum) err(`${at}: marks ${sec.marks} but slots add up to ${sum / 4}`);
}

function checkSplit(cs, at, err) {
  const levels = (cs && cs.levels) || {};
  const keys = Object.keys(levels);
  if (keys.length === 0 || !LEVEL_SETS.some((set) => keys.every((k) => set.includes(k)))) err(`${at}: unknown level in ${keys}`);
  if (keys.reduce((n, k) => n + levels[k], 0) !== 100) err(`${at}: split levels must sum to 100`);
  if (!cs || !SPLIT_STATUS.includes(cs.status)) err(`${at}: unknown split status ${cs && cs.status}`);
}

function checkShared(V, at, err) {
  const ids = V.sections.map((s) => s.id);
  const shared = V.shared_sections || [];
  shared.forEach((id) => {
    if (!ids.includes(id)) err(`${at}: shared section ${id} does not exist`);
  });
  if (shared.some((id) => (V.sections.find((s) => s.id === id) || {}).time_min != null)) err(`${at}: shared sections print no time of their own`);
  if (shared.length && V.shared_time_min == null) err(`${at}: shared sections need shared_time_min`);
  if (V.shared_time_min != null) checkTime(V.shared_time_min, `${at} shared`, err);
}

function checkVariant(V, at, err) {
  if (!STYLES.includes(V.scheme_style)) err(`${at}: unknown scheme_style ${V.scheme_style}`);
  checkSplit(V.cognitive_split, at, err);
  checkTime(V.total_time_min, at, err);
  const sections = Array.isArray(V.sections) ? V.sections : [];
  if (sections.length === 0) { err(`${at}: needs sections`); return; }
  dupes(sections.map((s) => s.id)).forEach((id) => err(`${at}: duplicate section id ${id}`));
  dupes(sections.flatMap((s) => (s.slots || []).map((l) => l.slot))).forEach((id) => err(`${at}: duplicate slot id ${id}`));
  sections.forEach((s) => checkSection(s, err));
  checkShared({ ...V, sections }, at, err);
  const all = sections.flatMap((s) => s.slots || []);
  const total4 = sections.reduce((n, s) => n + (isNum(s.marks_x4) ? s.marks_x4 : 0), 0);
  const tm4 = all.filter((s) => s.teacher_marked).reduce((n, s) => n + (s.total_x4 || 0), 0);
  if (x4(V.total_marks) !== total4) err(`${at}: total_marks ${V.total_marks} but sections add up to ${total4 / 4}`);
  if (x4(V.teacher_marked_marks) !== tm4) err(`${at}: teacher_marked_marks ${V.teacher_marked_marks} but slots add up to ${tm4 / 4}`);
  if (x4(V.generated_marks) !== total4 - tm4) err(`${at}: generated_marks ${V.generated_marks} but generated slots add up to ${(total4 - tm4) / 4}`);
}

function checkSubject(key, S, err) {
  const at = `subject ${key}`;
  if (S.key !== key) err(`${at}: key ${S.key} does not match its entry`);
  if (!['en', 'ur'].includes(S.medium)) err(`${at}: unknown medium ${S.medium}`);
  if (!S.source_id) err(`${at}: source_id is required`);
  if (!SUBJECT_STATUS.includes(S.status)) err(`${at}: unknown status ${S.status}`);
  if (S.status === 'ship_derived' && !S.derivation) err(`${at}: ship_derived needs its derivation note`);
  const variants = Array.isArray(S.variants) ? S.variants : [];
  if (variants.length === 0) { err(`${at}: needs variants`); return; }
  dupes(variants.map((v) => v.variant_id)).forEach((id) => err(`${at}: duplicate variant_id ${id}`));
  variants.forEach((v) => checkVariant(v, `${at} variant ${v.variant_id}`, err));
  if (S.total_marks !== variants[0].total_marks) err(`${at}: mirror total_marks ${S.total_marks} differs from the default variant`);
  if (!same(S.sections, variants[0].sections)) err(`${at}: mirror sections differ from the default variant`);
}

function validatePattern(P) {
  if (!P || typeof P !== 'object') return ['pattern: not an object'];
  const errors = [];
  const err = (m) => errors.push(m);
  if (P.profile !== 'board') err(`pattern: profile must be board, got ${P.profile}`);
  if (!P.id || typeof P.id !== 'string') err('pattern: id is required');
  if (!Number.isInteger(P.grade) || P.grade < 6 || P.grade > 12) err(`pattern: grade must be 6-12, got ${P.grade}`);
  const subjects = P.subjects && typeof P.subjects === 'object' ? P.subjects : {};
  const pending = P.pending && typeof P.pending === 'object' ? P.pending : {};
  if (Object.keys(subjects).length === 0) err('pattern: subjects is empty');
  Object.entries(subjects).forEach(([k, S]) => checkSubject(k, S || {}, err));
  Object.entries(pending).forEach(([k, p]) => {
    if (subjects[k]) err(`pending ${k}: also offered as a subject`);
    if (!p || p.status !== 'design_pending') err(`pending ${k}: status must be design_pending`);
    else if (!p.reason) err(`pending ${k}: a pending cell names its reason`);
  });
  return errors;
}

module.exports = { validatePattern };
