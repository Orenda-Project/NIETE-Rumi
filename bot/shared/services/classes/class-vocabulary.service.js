'use strict';
/**
 * Class vocabulary resolver.
 *
 * The seeded `grade_levels` and `subjects` tables are the canonical vocabulary.
 * This service is how code reads them, and how the legacy encodings already in
 * production resolve to a canonical code WITHOUT migrating their columns:
 *
 *   grade    'grade_3' slugs (users.grades_taught) · 'Grade Three' words
 *            (62,000 lesson_plan_catalog rows) · bare digits
 *   band     'PRIMARY'/'MIDDLE'/'HIGH' — 32 distinct spellings across 7,149
 *            leader_teachers.level rows, typos included
 *   subject  Math/Maths/maths · Science/General Science/GK-Science
 *
 * TWO DELIBERATE ASYMMETRIES:
 *
 *   1. A BAND IS NOT A GRADE. resolveGradeLevel('PRIMARY') returns null on
 *      purpose — 'PRIMARY' names five grades, and coercing it to one silently
 *      picks the wrong reading passage and the wrong lesson plan. Callers that
 *      hold a band-shaped value must use resolveBand() + gradesInBand().
 *
 *   2. THIS FAILS CLOSED. Every other gate in this codebase fails open so a
 *      teacher is never dead-ended, but the failure mode here is a WRONG grade
 *      rather than a missing screen — silently mis-assigning a child's class is
 *      worse than returning null and letting the caller ask. A failed load is
 *      also not cached, so a transient error self-heals on the next call.
 *
 * Band spellings live in code, not in a table: `band` is a CHECK-constrained
 * column, and the 32 legacy spellings are a tokenizer problem (separators,
 * casing, two typos), not reference data worth a third table. Rule 15.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/** Canonical ascending order, so a multi-band value has a stable shape. */
const BAND_ORDER = ['early_years', 'primary', 'middle', 'high', 'higher_secondary'];

/**
 * Token → canonical band. Includes the two typos actually present in
 * leader_teachers.level ('PRIMAYR', 'Parimary'); anything unrecognised is
 * dropped rather than guessed at.
 */
const BAND_TOKENS = new Map([
  ['early_years', 'early_years'], ['earlyyears', 'early_years'], ['early', 'early_years'],
  ['ece', 'early_years'], ['kg', 'early_years'],
  ['primary', 'primary'], ['primayr', 'primary'], ['parimary', 'primary'],
  ['pirmary', 'primary'], ['primry', 'primary'],
  ['middle', 'middle'], ['elementary', 'middle'], ['midle', 'middle'],
  ['high', 'high'], ['secondary', 'high'],
  ['higher_secondary', 'higher_secondary'], ['highersecondary', 'higher_secondary'],
  ['intermediate', 'higher_secondary'], ['inter', 'higher_secondary'],
]);

/** 'early years' → 'earlyyears' so multi-word bands survive tokenizing. */
function bandKey(token) {
  return token.replace(/[\s_-]+/g, '');
}

// ---------------------------------------------------------------------------
// Reference-table cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = { grades: null, gradesAt: 0, subjects: null, subjectsAt: 0 };

function fresh(at) {
  return at > 0 && Date.now() - at < CACHE_TTL_MS;
}

/** Build a lowercase alias → row index. Aliases win over nothing else; the code itself is always an alias in the seed. */
function indexByAlias(rows, extra = (r) => [r.code]) {
  const index = new Map();
  for (const row of rows) {
    const keys = [...(row.aliases || []), ...extra(row)];
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      index.set(key.trim().toLowerCase(), row);
    }
  }
  return index;
}

async function loadGrades() {
  if (fresh(cache.gradesAt) && cache.grades) return cache.grades;

  const { data, error } = await supabase
    .from('grade_levels')
    .select('code, ordinal, band, aliases, sort_order')
    .eq('is_active', true);

  if (error || !data) {
    // NOT cached — a transient error must not pin an empty vocabulary for 10
    // minutes and turn one blip into a silent outage.
    logToFile('⚠️ class-vocabulary: grade_levels load failed — resolution will return null', {
      error: error && error.message,
    });
    return null;
  }

  cache.grades = { rows: data, byAlias: indexByAlias(data) };
  cache.gradesAt = Date.now();
  return cache.grades;
}

async function loadSubjects() {
  if (fresh(cache.subjectsAt) && cache.subjects) return cache.subjects;

  const { data, error } = await supabase
    .from('subjects')
    .select('code, parent_code, aliases, sort_order')
    .eq('is_active', true);

  if (error || !data) {
    logToFile('⚠️ class-vocabulary: subjects load failed — resolution will return null', {
      error: error && error.message,
    });
    return null;
  }

  cache.subjects = { rows: data, byAlias: indexByAlias(data) };
  cache.subjectsAt = Date.now();
  return cache.subjects;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve any legacy grade spelling to its canonical row.
 *
 * @param {string} raw
 * @returns {Promise<{code: string, ordinal: number, band: string}|null>} null for
 *          junk, for an unknown spelling, AND for a band-shaped value — see the
 *          module header.
 */
async function resolveGradeLevel(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const vocabulary = await loadGrades();
  if (!vocabulary) return null;

  const hit = vocabulary.byAlias.get(raw.trim().toLowerCase());
  if (!hit) return null;

  return { code: hit.code, ordinal: hit.ordinal, band: hit.band };
}

/**
 * Normalize a band-shaped legacy value into canonical bands.
 *
 * Handles every separator seen in production ('+', '/', ',', '&', the word
 * 'and') and returns BAND_ORDER-sorted unique bands, so 'HIGH+MIDDLE' and
 * 'MIDDLE+HIGH' — both real values — produce the same answer.
 *
 * @param {string} raw
 * @returns {Promise<string[]>} empty array when nothing is recognised.
 */
async function resolveBand(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];

  const tokens = raw
    .toLowerCase()
    .split(/[+/,&]|\band\b/)
    .map((t) => bandKey(t.trim()))
    .filter(Boolean);

  const found = new Set();
  for (const token of tokens) {
    const band = BAND_TOKENS.get(token);
    if (band) found.add(band);
  }

  return BAND_ORDER.filter((b) => found.has(b));
}

/**
 * The grade codes belonging to a band — how a band-only legacy value is used
 * without being collapsed to a single grade.
 *
 * @param {string} band
 * @returns {Promise<string[]>} ascending by ordinal.
 */
async function gradesInBand(band) {
  const vocabulary = await loadGrades();
  if (!vocabulary) return [];

  return vocabulary.rows
    .filter((r) => r.band === band)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((r) => r.code);
}

/**
 * Resolve any subject spelling to its canonical code.
 *
 * @param {string} raw
 * @returns {Promise<string|null>} null when the subject is not one the LP corpus
 *          can serve — the seed is deliberately scoped, so 'Islamiat' and
 *          'Physics' resolve to null today. That is a scoping decision, not a bug.
 */
async function resolveSubject(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const vocabulary = await loadSubjects();
  if (!vocabulary) return null;

  const hit = vocabulary.byAlias.get(raw.trim().toLowerCase());
  return hit ? hit.code : null;
}

/** Test seam / ops escape hatch — drop the cached vocabulary. */
function clearCache() {
  cache.grades = null;
  cache.gradesAt = 0;
  cache.subjects = null;
  cache.subjectsAt = 0;
}

module.exports = {
  resolveGradeLevel,
  resolveBand,
  gradesInBand,
  resolveSubject,
  clearCache,
  BAND_ORDER,
};
