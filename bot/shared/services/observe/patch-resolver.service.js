/**
 * A coach's people, DERIVED from her schools.
 *
 * Operator, 2026-08-28: "The coach to school assignment is the canonical one.
 * If there is a teacher who is assigned to coach A but her school is assigned
 * to coach B, that's a flaw in data. Whoever has the school has the teacher."
 *
 *     leader_schools (coach -> school)  ×  users.school_id (person -> school)
 *
 * This replaces `leader_teachers` as the source of truth for who a coach may
 * observe. That table stored the answer; this computes it, so the two can no
 * longer disagree — which they did on 230 rows.
 *
 * Measured against prod 2026-08-28:
 *   · 8,034 coach-person pairs stored today, 9,804 derived (principals in).
 *   · 233 stored pairs disappear. 168 are the flaw above, 8 are teachers with no
 *     school, the rest are unregistered/roleless stragglers. All of them are
 *     data to fix, not relationships to preserve.
 *   · 354 principals gain a coach. Principals ARE observed here — 16 leader
 *     observations of 15 principals by 15 coaches, the most recent 27 Aug — so
 *     they belong in the patch. They are LABELLED, because an unlabelled
 *     principal in a teacher picker is how the wrong person gets observed.
 *   · 85 of 400 assigned schools have more than one coach, so two coaches
 *     sharing a person is normal and must never read as an error.
 */

'use strict';

/** Only these two roles are ever in a patch. Not coaches, not unregistered. */
const PATCH_ROLES = new Set(['teacher', 'principal']);

// ── band ───────────────────────────────────────────────────────────────

/**
 * The teaching band, from `users` rather than the old `leader_teachers.level`.
 *
 * `training_bands` covers 2,492 of the 2,540 people whose only band used to be
 * the roster column, so it is the primary source and `grades_taught` the
 * fallback. The 48 with neither return null: the old column held 33 spellings
 * including 'PRIMAYR' and 'Parimary', and guessing a band is how a lesson plan
 * gets built for the wrong grade.
 */
const BAND_TOKENS = new Map([
  ['early_years', 'early_years'], ['earlyyears', 'early_years'], ['early', 'early_years'],
  ['ece', 'early_years'], ['kg', 'early_years'],
  ['primary', 'primary'], ['primayr', 'primary'], ['parimary', 'primary'],
  ['middle', 'middle'], ['elementary', 'middle'],
  ['high', 'high'], ['secondary', 'high'],
]);

function _band(token) {
  const t = String(token == null ? '' : token).trim().toLowerCase().replace(/[^a-z_]/g, '');
  return BAND_TOKENS.get(t) || null;
}

function bandOf(user = {}) {
  const bands = Array.isArray(user.training_bands) ? user.training_bands : [];
  for (const b of bands) {
    const hit = _band(b);
    if (hit) return hit;
  }
  return _band(user.grades_taught);
}

// ── shaping ────────────────────────────────────────────────────────────

/**
 * One database row -> one person in the patch.
 *
 * `isPrincipal` is not cosmetic. 354 principals arrive in patches that never
 * had them, and a picker row that does not say so is indistinguishable from a
 * teacher.
 */
function shapePatchRow(r = {}) {
  const isPrincipal = r.role === 'principal';
  return {
    userId: r.user_id || r.id || null,
    name: r.first_name || null,
    phone: r.phone_number || null,
    role: r.role || null,
    isPrincipal,
    roleLabel: isPrincipal ? 'Principal' : '',
    schoolId: r.school_id || null,
    schoolName: r.school_name || null,
    emis: r.emis == null ? null : String(r.emis),
    band: bandOf(r),
  };
}

/**
 * One row per PERSON, teachers first.
 *
 * Two of a coach's schools can name the same person (she moved, or the register
 * lists her twice), and the join would hand her back once per school. Keyed on
 * user id rather than phone because a phone can be missing and a user id cannot.
 *
 * Teachers sort before principals: the coach opened this to find a teacher, and
 * a picker caps at 20 rows.
 */
function dedupePatch(rows = []) {
  const byPerson = new Map();
  for (const r of rows || []) {
    const shaped = r && r.userId ? r : shapePatchRow(r);
    const key = shaped.userId || shaped.phone;
    if (!key || byPerson.has(key)) continue;
    byPerson.set(key, shaped);
  }
  return [...byPerson.values()].sort((a, b) => {
    if (a.isPrincipal !== b.isPrincipal) return a.isPrincipal ? 1 : -1;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

// ── the query ──────────────────────────────────────────────────────────

/**
 * The join, once, in one place.
 *
 * `leader_schools.school_id` is a declared FK to `schools(id)` that is 0%
 * populated, so today the link is the text `school_ext_id` = 'niete:' || emis.
 * COALESCE lets the same statement work before and after that column is
 * backfilled, so the backfill needs no second code change.
 */
const PATCH_SQL = `
  SELECT u.id            AS user_id,
         u.phone_number,
         u.first_name,
         u.role,
         u.training_bands,
         u.grades_taught,
         s.id            AS school_id,
         s.name          AS school_name,
         s.emis
  FROM leader_schools ls
  JOIN schools s
    ON s.id = COALESCE(ls.school_id, s.id)
   AND ('niete:' || s.emis = ls.school_ext_id OR ls.school_id = s.id)
  JOIN users u
    ON u.school_id = s.id
   AND u.role = ANY($2)
  WHERE ls.leader_user_id = $1
`;

/** Every person this coach may observe. `query` is injected for testability. */
async function listPatch(query, leaderUserId) {
  const { rows } = await query(PATCH_SQL, [leaderUserId, [...PATCH_ROLES]]);
  return dedupePatch((rows || []).map(shapePatchRow));
}

module.exports = {
  PATCH_ROLES,
  PATCH_SQL,
  bandOf,
  shapePatchRow,
  dedupePatch,
  listPatch,
};
