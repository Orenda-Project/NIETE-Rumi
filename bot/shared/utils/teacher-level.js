'use strict';
/**
 * A teacher's level — read it from here, and from nowhere else.
 *
 * WHY THIS EXISTS
 * `users` carried FOUR columns that each claimed to answer "what does this
 * teacher teach?": training_bands, grades_taught, levels, grade. Measured on
 * production across 15,071 users, they did not agree — 233 teachers held
 * contradictory values, some sharing no band at all (`levels: [PRIMARY]` beside
 * `training_bands: [HIGH, MIDDLE]`). Which answer a feature got depended on
 * which column its author happened to reach for.
 *
 * Worse, the one shared helper — `bandOf()` in patch-resolver — read TWO
 * columns with a fallback and returned only the FIRST band, so a teacher
 * teaching MIDDLE and HIGH was silently handled as MIDDLE alone.
 *
 * So: `users.teacher_level` (renamed from training_bands) is the single source,
 * and this module is the single way to read it.
 *
 * THE TWO RULES
 *   1. NO FALLBACK. An empty teacher_level means "we do not know", not "look in
 *      another column". A fallback is precisely how two columns disagreeing
 *      became two different answers for one teacher.
 *   2. ALL BANDS. teacherLevelOf() returns every band. Reach for
 *      primaryBandOf() only where a single value is genuinely required, and it
 *      picks by canonical order so the answer never depends on array order.
 *
 * `grades_taught` is NOT consulted here. It survives with a different job — the
 * finer signup record (grade_1..grade_10, early_years, higher_secondary) that
 * attendance setup uses to order the class dropdown. It is not a band.
 * bandsFromGrades() converts it, and exists for the backfill and for
 * registration, never for a read-time fallback.
 *
 * Writing is not this module's business: `applyBandSelection()` remains the one
 * writer, because it also reconciles teacher_training_assignments and enforces
 * the 48-hour cooldown on teacher_level_updated_at.
 */

/** Canonical order: the ascending grade range. Order is load-bearing for primaryBandOf. */
const VALID_LEVELS = Object.freeze(['PRIMARY', 'MIDDLE', 'HIGH']);
const _RANK = new Map(VALID_LEVELS.map((b, i) => [b, i]));

/** grade granularity -> band. The only place this mapping is written down. */
const GRADE_TO_BAND = Object.freeze({
  early_years: 'PRIMARY',
  grade_1: 'PRIMARY', grade_2: 'PRIMARY', grade_3: 'PRIMARY', grade_4: 'PRIMARY', grade_5: 'PRIMARY',
  grade_6: 'MIDDLE', grade_7: 'MIDDLE', grade_8: 'MIDDLE',
  grade_9: 'HIGH', grade_10: 'HIGH', higher_secondary: 'HIGH',
});

/** Canonical-order, de-duplicated. */
function _order(set) {
  return VALID_LEVELS.filter((b) => set.has(b));
}

/**
 * Every band this teacher teaches, from `users.teacher_level` alone.
 *
 * Unknown tokens are DROPPED, never defaulted — a silent default to PRIMARY is
 * how a HIGH teacher lands in a primary training programme.
 *
 * @param {?object} user a users row
 * @returns {string[]} bands in canonical order; [] when unknown
 */
function teacherLevelOf(user) {
  const raw = user && user.teacher_level;
  if (!Array.isArray(raw)) return [];
  const found = new Set();
  for (const tok of raw) {
    const t = String(tok == null ? '' : tok).trim().toUpperCase();
    if (_RANK.has(t)) found.add(t);
  }
  return _order(found);
}

/**
 * One band, for the places that genuinely cannot take a list.
 *
 * Picks by canonical order rather than array order, so two rows storing the
 * same bands in a different sequence resolve the same way. Prefer
 * teacherLevelOf() — a teacher with two bands has two bands.
 *
 * @returns {?string} the lowest band held, or null
 */
function primaryBandOf(user) {
  const bands = teacherLevelOf(user);
  return bands.length ? bands[0] : null;
}

/**
 * Bands implied by a signup `grades_taught` value.
 *
 * For the backfill and for registration — NOT a read-time fallback. Production
 * stores this column three ways, all of which arrive here: a bare token
 * ('PRIMARY'), a comma string ('PRIMARY, MIDDLE'), and a stringified JSON array
 * ('["grade_6","grade_7"]', 233 rows).
 *
 * @param {string|string[]|null} value
 * @returns {string[]} bands in canonical order; [] when nothing maps
 */
function bandsFromGrades(value) {
  if (value == null) return [];
  const tokens = Array.isArray(value)
    ? value
    : String(value).replace(/[[\]"]/g, '').split(',');

  const found = new Set();
  for (const tok of tokens) {
    const t = String(tok == null ? '' : tok).trim();
    if (!t) continue;
    const upper = t.toUpperCase();
    if (_RANK.has(upper)) { found.add(upper); continue; }
    const mapped = GRADE_TO_BAND[t.toLowerCase()];
    if (mapped) found.add(mapped);
  }
  return _order(found);
}

module.exports = {
  VALID_LEVELS,
  GRADE_TO_BAND,
  teacherLevelOf,
  primaryBandOf,
  bandsFromGrades,
};
