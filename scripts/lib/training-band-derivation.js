/**
 * bd-2672 — derive a teacher's grade-band(s) and the training program(s) that follow.
 *
 * WHY THIS EXISTS
 * Two vocabularies live in the users table and nothing translated between them:
 *
 *   users.levels        ['PRIMARY','MIDDLE','HIGH']   written only by the bulk
 *                                                     import (migrate-users.py),
 *                                                     read only by an offline migration
 *   users.grades_taught grade ids from the Flow       written at registration,
 *                                                     read by nothing in the training path
 *
 * Access scoping speaks bands; registration collects grades. That missing
 * translation is why an imported teacher has training and an organically
 * registered one does not. This module is the translation.
 *
 * Grade vocabulary: bot/shared/config/registration-data.js:111-124
 * Programs: training_programs.key, scoped via training_program_scopes.
 *
 * SIGNAL-LESS USERS GET NOTHING.
 * deriveBands returns null and programsForUser returns [] when a user has
 * neither levels nor parseable grades_taught. That is a decision (operator,
 * 2026-08-13), not an oversight: 125 users are in that bucket, and assigning
 * them a default program would invent access we have no basis for. Wrong-band
 * access hides content a teacher needs and is invisible once written; no access
 * at least surfaces itself as "No training assigned yet". Onboarding will ask
 * them directly.
 */

const BAND_PRIMARY = 'PRIMARY';
const BAND_MIDDLE = 'MIDDLE';
const BAND_HIGH = 'HIGH';

const VALID_BANDS = new Set([BAND_PRIMARY, BAND_MIDDLE, BAND_HIGH]);

const PROGRAM_PRIMARY = 'niete_primary';
const PROGRAM_MIDDLE_HIGH = 'niete_middle_high';

/**
 * Bands supplied by a human where the data cannot supply them.
 *
 * 923215531977 has both levels and grades_taught null, so derivation yields
 * nothing. The band comes from the reviewer on the ICT priority sheet (Row 8:
 * "1. 03215531977 - primary"), who knows the teacher. Keyed by E.164.
 *
 * This is deliberately a short, visible list. It is the difference between one
 * auditable human judgement and 125 silent guesses.
 */
const OVERRIDES = Object.freeze({
  923215531977: [PROGRAM_PRIMARY],
});

/** Map a single grade token to its band, or null if unrecognized. */
function bandForGradeToken(token) {
  const t = String(token).trim().toLowerCase();
  if (!t) return null;

  // A migrated user's grades_taught is a comma-joined copy of the band array
  // (migrate-users.py:318), so the token may already BE a band.
  const asBand = t.toUpperCase();
  if (VALID_BANDS.has(asBand)) return asBand;

  // "grade_9" -> 9. Also tolerates "Grade 9", "9".
  const digits = t.replace(/[^0-9]/g, '');
  if (digits) {
    const n = parseInt(digits, 10);
    if (!Number.isFinite(n) || n < 1 || n > 12) return null;
    if (n <= 5) return BAND_PRIMARY;
    if (n <= 8) return BAND_MIDDLE;
    return BAND_HIGH;
  }

  if (t === 'early_years' || t.startsWith('early')) return BAND_PRIMARY;
  if (t === 'higher_secondary' || t.includes('secondary')) return BAND_HIGH;

  return null;
}

/** Split grades_taught into tokens. Handles the JSON-array and comma-joined shapes. */
function tokenize(gradesTaught) {
  if (typeof gradesTaught !== 'string') return [];
  const raw = gradesTaught.trim();
  if (!raw) return [];

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Malformed JSON is treated as no signal rather than salvaged — a
      // half-parsed grade list is a worse input than an absent one.
      return [];
    }
  }

  return raw.split(',');
}

/**
 * @returns {string[]|null} sorted unique bands, or null when there is no signal.
 */
function deriveBands(user) {
  if (!user || typeof user !== 'object') return null;

  // users.levels is already a band array and outranks grades_taught: it came
  // from the source system, whereas grades_taught is self-reported at signup.
  if (Array.isArray(user.levels) && user.levels.length > 0) {
    const fromLevels = user.levels
      .map((l) => String(l).trim().toUpperCase())
      .filter((l) => VALID_BANDS.has(l));
    if (fromLevels.length > 0) return [...new Set(fromLevels)].sort();
  }

  const bands = tokenize(user.grades_taught)
    .map(bandForGradeToken)
    .filter(Boolean);

  if (bands.length === 0) return null;
  return [...new Set(bands)].sort();
}

/**
 * @returns {string[]} program keys to assign. Empty when the user has no signal.
 */
function programsForUser(user, overrides = null) {
  if (overrides && user && user.phone_number) {
    const hit = overrides[String(user.phone_number)];
    if (hit) return [...hit];
  }

  const bands = deriveBands(user);
  if (!bands) return [];

  const programs = [];
  if (bands.includes(BAND_PRIMARY)) programs.push(PROGRAM_PRIMARY);
  // MIDDLE and HIGH share one program, so both collapse to a single row.
  if (bands.includes(BAND_MIDDLE) || bands.includes(BAND_HIGH)) {
    programs.push(PROGRAM_MIDDLE_HIGH);
  }
  return programs;
}

module.exports = {
  deriveBands,
  programsForUser,
  bandForGradeToken,
  OVERRIDES,
  PROGRAM_PRIMARY,
  PROGRAM_MIDDLE_HIGH,
};
