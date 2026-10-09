'use strict';
/**
 * bd-fmf24g.3 — ONE subject vocabulary for the teacher app v2.
 *
 * WHY
 * ---
 * The grade·subject picker lists HER classes, and the pick then opens a lesson plan, a paper or
 * a Digital Coaching recording. Each of those sources spells the same subject its own way:
 *
 *   her classes          class_teacher_subjects.subject_code   maths · science · social_studies
 *   K-5 lesson plans     catalogue subject_key / name          math · general_science / Math
 *   6-12 lesson plans    corpus free text                      Mathematics · Pak Studies · Physics
 *   assessment           subject_key / label                   maths · science / Maths · Science
 *   Digital Coaching     analysis_data.subject_resolution      maths · science (registry codes)
 *
 * Two directions, both here: any spelling → one KEY (`subjectKey`), and a key → a catalogue's own
 * entry for it (`matchCatalogue`), so the picker can hand each feature the key IT wants back.
 *
 * NOT A THIRD ALIAS TABLE. The folding already exists twice in the bot and both are reused:
 *   - coaching/subject-resolution.js `canonicalSubject` — the DB `subjects` registry codes and
 *     their measured spellings (a drift test pins it to the registry). Registry codes ARE the
 *     class and assessment codes, so they are the keys here.
 *   - config/lp612-subject-order.js `normalizeSubject` — the 6-12 corpus spellings, for the
 *     subjects the registry does not hold (Physics, Computer Science, Pakistan Studies…). Those
 *     get a slug of the normalised name as their key.
 * Both are pure, dependency-free modules, so requiring them from the portal is safe
 * (tests/portal/portal-reaches-bot-modules.test.js).
 *
 * An unknown subject is KEPT under its own slug — a teacher's class is never dropped because a
 * list here did not name it — and never matched to the nearest known one.
 */

const { canonicalSubject } = require('../../bot/shared/services/coaching/subject-resolution');
const { normalizeSubject, SUBJECT_NAMES_UR } = require('../../bot/shared/config/lp612-subject-order');
const { SUBJECT_LABELS } = require('../../bot/shared/config/ux-strings');
const { SUBJECT_LABEL: ASSESSMENT_LABEL } = require('../../bot/shared/services/assessment/assessment-vocabulary');

const slug = (s) => s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Any spelling of a subject → its key, or null when there is nothing usable.
 * @param {*} raw
 * @returns {string|null}
 */
function subjectKey(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const registry = canonicalSubject(raw);
  if (registry) return registry;
  const key = slug(normalizeSubject(raw));
  return key || null;
}

const titleCase = (key) => key.split('_').filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/**
 * The subject's name for her. NIETE's offer is flat en/ur; anything else reads as English.
 * Urdu with no Urdu name keeps the English word — untranslated, not wrong.
 * @param {string} key
 * @param {string} [lang]
 */
function subjectName(key, lang = 'en') {
  const k = String(key || '');
  const label = SUBJECT_LABELS[k];
  if (lang === 'ur') {
    if (label && label.ur) return label.ur;
    const ur = SUBJECT_NAMES_UR[normalizeSubject(k.replace(/_/g, ' '))];
    if (ur) return ur;
  }
  if (label && label.en) return label.en;
  return ASSESSMENT_LABEL[k] || titleCase(k);
}

/**
 * The catalogue entry that IS this subject, or null. `entries` are a catalogue's own rows as
 * { key, name } — the K-5 subject_key, the 6-12 corpus name, the assessment subject_key — and
 * the entry comes back untouched, so the caller sends the catalogue its own key.
 * @param {string|null} key
 * @param {Array<{key: string, name?: string}>|null} entries
 */
function matchCatalogue(key, entries) {
  if (!key || !Array.isArray(entries)) return null;
  return entries.find((e) => e && (subjectKey(e.key) === key || subjectKey(e.name) === key)) || null;
}

/**
 * A class grade_code ('grade_4', 'early_years') or a grade number → { grade, gradeCode }.
 * Early years is kept with no number: no lesson plan or paper has one, but it is her class.
 */
function gradeOf(raw) {
  if (raw === 'early_years') return { grade: null, gradeCode: 'early_years' };
  const m = /^(?:grade_)?(\d{1,2})$/.exec(String(raw == null ? '' : raw).trim());
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return { grade: n, gradeCode: `grade_${n}` };
}

module.exports = { subjectKey, subjectName, matchCatalogue, gradeOf };
