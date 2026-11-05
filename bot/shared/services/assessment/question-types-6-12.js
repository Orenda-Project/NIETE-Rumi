'use strict';
/**
 * Question types for grades 6-12 (G612 contract 5, question-types.md).
 *
 * The data is the contract file `question-types-6-12.data.json`: a closed enum of slot types, the
 * item kinds used inside srq/erq, and which ids each type set may offer per band. A cell's type set
 * and band come from the registry (subject-config.js), so this module never guesses a subject.
 *
 * question-types.js sends every grade >= 6 call here through three guard lines; grades 1-5 never
 * reach this file. Every function answers [] / nothing for grade <= 5 so it cannot leak downwards.
 */

const DATA = require('./question-types-6-12.data.json');
const SubjectConfig = require('./subject-config');

const TYPES = new Map(DATA.types.map((t) => [t.id, t]));
const KINDS = new Map(DATA.kinds.map((k) => [k.id, k]));
const BOARD_MODES = new Set(['board', 'term']);
const KIND_HOSTS = new Set(['srq', 'erq']);
const DEFAULT_OBJECTIVE = 'mcq';
const DEFAULT_SUBJECTIVE = 'srq';

// Drift strings seen in generated papers -> enum id (question-types.md §3). A string that is
// already an enum id needs no entry. `timeline` depends on the type set; `other` is rejected.
const ALIASES = {
  mcq_stimulus: 'scenario',
  correct_sentence: 'true_false_correct',
  sequence_text: 'sequence',
  timeline_text: 'sequence',
  tashreeh_prose: 'explanation_prose',
  tashreeh_poem: 'explanation_poem',
  tashreeh_ghazal: 'explanation_ghazal',
};
const TIMELINE_BY_SET = { islamiat: 'erq', social: 'sequence' };

function isSecondary(grade) {
  return Number(grade) >= 6;
}

/** The registry row for the cell, or null for grade <= 5 or any cell it does not offer. */
function rowFor(subject, grade) {
  if (!isSecondary(grade)) return null;
  try {
    return SubjectConfig.resolve(grade, subject);
  } catch (err) {
    return null;
  }
}

function setIds(row) {
  return (row && DATA.type_sets[row.type_set] && DATA.type_sets[row.type_set][row.band]) || [];
}

function categoryOf(typeId) {
  const t = TYPES.get(typeId);
  return t ? t.category : 'subjective';
}

/** board_paper first for a board/term cell, then the cell's type set; [] for an unknown cell. */
function forSubject(subject, grade) {
  const row = rowFor(subject, grade);
  if (!row) return [];
  const ids = [...(BOARD_MODES.has(row.board_mode) ? [DATA.first_entry] : []), ...setIds(row)];
  return ids.map((id) => ({ id, category: categoryOf(id) }));
}

/** The flow-selectable kinds the cell's type set may use (each maps to srq/erq). */
function kindsFor(subject, grade) {
  const row = rowFor(subject, grade);
  if (!row) return [];
  const ids = setIds(row);
  return DATA.kinds
    .filter((k) => k.flow_selectable && ids.includes(k.maps_to)
      && (k.type_sets === 'all' || k.type_sets.includes(row.type_set)))
    .map((k) => k.id);
}

/** Same spread as QuestionTypes.withCounts: the remainder goes to the earlier types. */
function withCounts(pickedIds, total, subject, grade) {
  const ids = (pickedIds || []).filter(Boolean);
  if (ids.length === 0) return defaultMix(subject, grade, total);
  const wanted = Math.max(1, Number(total) || ids.length);
  const base = Math.floor(wanted / ids.length);
  let spare = wanted - (base * ids.length);
  return ids.map((id) => {
    const count = base + (spare > 0 ? 1 : 0);
    if (spare > 0) spare -= 1;
    return { id, count: Math.max(1, count), category: categoryOf(id) };
  });
}

/** One objective and one subjective type: mcq and srq where the set has them, else the first of each. */
function defaultMix(subject, grade, total) {
  const ids = setIds(rowFor(subject, grade));
  const objective = ids.filter((id) => categoryOf(id) === 'objective');
  const subjective = ids.filter((id) => categoryOf(id) === 'subjective');
  const pick = [
    objective.includes(DEFAULT_OBJECTIVE) ? DEFAULT_OBJECTIVE : objective[0],
    subjective.includes(DEFAULT_SUBJECTIVE) ? DEFAULT_SUBJECTIVE : subjective[0],
  ].filter(Boolean);
  return pick.length ? withCounts(pick, total, subject, grade) : [];
}

function titleOf(id, lang = 'en') {
  const t = TYPES.get(id) || KINDS.get(id);
  if (!t) return id;
  return lang === 'ur' ? t.title_ur : t.title_en;
}

/** A type string from generated output -> {ok, id} or {ok:false, reason}. Never coerces `other`. */
function normaliseType(seen, typeSet) {
  const s = String(seen ?? '').trim().toLowerCase();
  const id = s === 'timeline' ? TIMELINE_BY_SET[typeSet] : (ALIASES[s] || s);
  if (!id) return { ok: false, reason: `TYPE_UNRESOLVED: "${s}" has no meaning in type set ${typeSet}` };
  if (id === DATA.first_entry || !TYPES.has(id)) return { ok: false, reason: `TYPE_UNKNOWN: "${s}"` };
  return { ok: true, id };
}

/** null is always allowed; otherwise the kind must be in the enum and sit on srq/erq. */
function kindAllowed(kind, typeId) {
  if (kind === null || kind === undefined) return true;
  return KINDS.has(kind) && KIND_HOSTS.has(typeId);
}

module.exports = {
  DATA, isSecondary, forSubject, kindsFor, categoryOf, withCounts, defaultMix, titleOf, normaliseType, kindAllowed,
};
