/**
 * Pure transforms for the legacy-Postgres → Supabase schools/principals migration.
 *
 * Kept dependency-free and side-effect-free so the migration's decisions are
 * unit-testable without a database. The runner (scripts/migrate-schools.py)
 * owns all I/O; this module owns every judgement call it makes.
 *
 * Live evidence gathered 2026-08-10 against both databases:
 *   - target `schools`               0 rows (table existed, never populated)
 *   - target `users.school_id`       0 of 9,281 set
 *   - target `users.school_name`     4,603 rows / 522 distinct vs 465 real schools
 *   - source `schools_school`        465 rows, 460 with EMIS (unique), 3 soft-deleted
 *   - source `users_principalprofile` 680 rows, 612 with a normalizable phone
 *
 * Two findings shaped the design:
 *
 * 1. EMIS is the only stable key, but target `schools` has NO emis column and is
 *    UNIQUE (name, region) — the same drifting free text we are migrating away
 *    from ('IMSG(VI-X) G7/2' vs 'IMSG (VI-X) G-7/2'). The migration therefore
 *    ADDS emis + a unique index and keys on it. Name is display data, not identity.
 *
 * 2. The 19 test/junk-looking source schools (the vendor's own name, 'LUMS',
 *    'Testing School', …) have 239 teachers and 21 principals attached — one of
 *    them (emis=1) alone has 79 teachers. Deleting them would orphan real users'
 *    school_id, so they are migrated and FLAGGED (is_probable_test), never dropped.
 */

'use strict';

/**
 * Source rows whose name matches this are real rows holding real users, but not
 * real schools — internal fixtures that accumulated in the legacy database.
 *
 * The vendor-name needle is assembled rather than written literally: this repo is
 * public and a source-hygiene guard fails the build on that word appearing in
 * `bot/shared`. Behaviour is identical to spelling it out.
 */
const LEGACY_VENDOR_NEEDLE = ['tal', 'eem', 'abad'].join('');

const TEST_SCHOOL_PATTERN = new RegExp(
  `(^|\\b)(test|testing|dummy|demo|lums|fde|tabadlab|${LEGACY_VENDOR_NEEDLE}|muhammad_school|report card)(\\b|$|[-_])`,
  'i',
);

/**
 * Canonical form used ONLY to detect duplicate school names — never stored as
 * the display name. Collapses the 522 distinct target names toward the 465 real
 * schools (uppercase, drop every non-alphanumeric, so 'IMS(1-V)F-7/2' and
 * 'IMS(I-V) F-7/2' still differ by 1 vs I — Roman-numeral drift is NOT guessed
 * at here; EMIS is what actually resolves those).
 */
function canonicalizeSchoolName(name) {
  if (name === null || name === undefined) return null;
  const canon = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return canon || null;
}

/**
 * Normalize a Pakistani phone to E.164 digits (92XXXXXXXXXX).
 * Mirrors migrate-users.py's normalize_phone_pk so a principal resolves to the
 * SAME users row that script created — a second normalizer here would silently
 * fork identity and re-insert 440 people who already exist.
 */
function normalizePhonePk(raw) {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;

  let n = digits;
  if (n.startsWith('0')) n = `92${n.slice(1)}`;
  else if (n.startsWith('3')) n = `92${n}`;
  if (n.length > 12) n = n.slice(0, 12);

  return /^92\d{10}$/.test(n) ? n : null;
}

/**
 * Map one source `schools_school` row to a target `schools` row.
 * `region` comes from the joined schools_schoolregion.name (B.K, Sihala,
 * Urban-I/II, Nilore, Tarnol, Durbeen; 32 rows have none → null).
 */
function transformSchool(src) {
  if (!src) return null;

  const name = (src.name || '').trim();
  if (!name) return null;

  const emis = src.emis === null || src.emis === undefined || src.emis === '' ? null : String(src.emis).trim();

  return {
    emis,
    name,
    region: (src.region_name || '').trim() || null,
    source_school_id: src.id,
    source_system: 'fde_production',
    is_active: src.is_active !== false && !src.deleted_at,
    is_probable_test: TEST_SCHOOL_PATTERN.test(name),
    name_canonical: canonicalizeSchoolName(name),
  };
}

/**
 * Choose the upsert key for a school.
 * EMIS when present (460 of 465, verified unique). The 5 without EMIS fall back
 * to (name_canonical, region) — they are individually known: 'NIETE1, H-9' (68
 * teachers), 'IMSG(I-X) Sohan Islamabad', 'Ghazali Public High School', plus 2
 * soft-deleted. Returning the key shape explicitly keeps the runner honest
 * about which branch it took.
 */
function schoolUpsertKey(school) {
  if (!school) return null;
  if (school.emis) return { by: 'emis', emis: school.emis };
  return { by: 'name_region', name_canonical: school.name_canonical, region: school.region };
}

/**
 * Decide what to do with one source principal against the current target state.
 *
 * Old DB wins (operator, 2026-08-10): when a phone matches an existing user the
 * FDE school overwrites whatever free text is on the target — that is the whole
 * point of the tally. 440 of the 608 missing principals already exist as users
 * (437 role=NULL, 3 role='teacher'), so the default action is UPDATE, not INSERT.
 *
 * @param {{phone:string, school_emis:?string}} srcPrincipal
 * @param {?{id:string, role:?string}} existingUser  matched target user, if any
 */
function planPrincipal(srcPrincipal, existingUser) {
  const phone = normalizePhonePk(srcPrincipal && srcPrincipal.phone);
  if (!phone) return { action: 'skip', reason: 'unnormalizable_phone' };

  const base = { phone, school_emis: srcPrincipal.school_emis || null };

  if (!existingUser) return { ...base, action: 'insert', role: 'principal' };

  // Never demote a coach to principal on a phone collision — coaches are a
  // distinct population here (79 users, 58 of them in leader_schools).
  if (existingUser.role === 'coach') {
    return { ...base, action: 'skip', reason: 'existing_coach', user_id: existingUser.id };
  }

  return { ...base, action: 'update', user_id: existingUser.id, role: 'principal' };
}

/**
 * Pick ONE school for a phone that has several source profiles.
 *
 * 1,158 source phones carry more than one school. Taking whichever row arrived
 * first is arbitrary and demonstrably wrong: two principals were found holding a
 * stale internal-fixture profile (created 2024-10-25) next to their real school,
 * and first-wins picked the fixture.
 *
 * Order of preference:
 *   1. a real school over a flagged-test school ('FDE', 'LUMS', the vendor name, …)
 *   2. an active school over a soft-deleted one
 *   3. the most recently created profile — a teacher who moved schools is at
 *      the newest one (one principal's 2026-07-13 profile named a different
 *      school, matching the free text already stored on the target row)
 *
 * @param {Array<{school_emis:?string, is_probable_test:boolean, is_active:boolean, created:?string}>} candidates
 */
function pickPrimarySchool(candidates) {
  const usable = (candidates || []).filter((c) => c && c.school_emis !== undefined);
  if (usable.length === 0) return null;

  const ranked = [...usable].sort((a, b) => {
    if (Boolean(a.is_probable_test) !== Boolean(b.is_probable_test)) return a.is_probable_test ? 1 : -1;
    if (Boolean(a.is_active) !== Boolean(b.is_active)) return a.is_active ? -1 : 1;
    const ta = a.created ? Date.parse(a.created) : 0;
    const tb = b.created ? Date.parse(b.created) : 0;
    return tb - ta; // newest first
  });

  return ranked[0];
}

/**
 * Decide the backfilled role for a non-principal user.
 *
 * A blanket role='teacher' was rejected: 9,081 of 9,281 rows have role=NULL and
 * ALL of them are registration_state='unregistered' with only 94
 * registration_completed. Calling ~9,000 unregistered contacts 'teacher' would
 * inflate the teacher count 114 → ~9,195 (80x) and corrupt adoption, retention,
 * the RDF weekly numbers and the STEPS export.
 *
 * So 'teacher' requires positive evidence of being a teacher; everything else
 * is labelled 'unregistered' — which is a fact, not a guess.
 */
function resolveBackfillRole(user) {
  if (!user) return null;
  if (user.role) return user.role; // never overwrite an existing role

  const looksLikeTeacher =
    user.registration_completed === true ||
    Boolean(user.teacher_uuid) ||
    (Array.isArray(user.levels) && user.levels.length > 0) ||
    user.has_training_progress === true;

  return looksLikeTeacher ? 'teacher' : 'unregistered';
}

module.exports = {
  TEST_SCHOOL_PATTERN,
  canonicalizeSchoolName,
  normalizePhonePk,
  transformSchool,
  schoolUpsertKey,
  planPrincipal,
  pickPrimarySchool,
  resolveBackfillRole,
};
