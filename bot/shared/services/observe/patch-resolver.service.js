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
const { teacherLevelOf, primaryBandOf } = require('../../utils/teacher-level');
const { isOnPrincipalApp } = require('./principal-app-switch');
// EMIS, else the holding key: the one rule every observation_schedules writer keys a school by.
const { schoolKeyOf } = require('./school-key');

const PATCH_ROLES = new Set(['teacher', 'principal']);

// ── band ───────────────────────────────────────────────────────────────

/**
 * The teaching band, from `users.teacher_level` and nowhere else.
 *
 * This used to read `training_bands` and FALL BACK to `grades_taught`, and it
 * returned only the FIRST band — so a teacher teaching MIDDLE and HIGH was
 * silently handled as MIDDLE. Both are fixed: one column, and the caller can
 * see every band. Returning null when unknown is deliberate and unchanged —
 * guessing a band is how a lesson plan gets built for the wrong grade.
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
  // Lowercased for the coach-facing picker, which has always rendered it that
  // way; primaryBandOf() decides WHICH band by canonical order rather than by
  // however the array happened to be stored.
  const band = primaryBandOf(user);
  return band ? band.toLowerCase() : null;
}

/** Every band this person teaches — prefer this where a list is acceptable. */
function bandsOf(user = {}) {
  return teacherLevelOf(user);
}

// ── the picker label ───────────────────────────────────────────────────

/** Manage teachers' word for a principal; every picker prints this same word. */
const PRINCIPAL_LABEL = 'Principal';
/** The words the level screen already offers (TEACHER_EDIT_LEVEL: Primary / Middle / High). Latin: picker chrome. */
const BAND_WORD = Object.freeze({ PRIMARY: 'Primary', MIDDLE: 'Middle', HIGH: 'High' });

/**
 * bd-r2uzg1.18.5 — EVERY band, for a coach to read: 'Primary + Middle + High'. '' when none is on record.
 *
 * The pickers printed bandOf() — the lowest band only — so a teacher of all three read as "primary"
 * while her profile listed three, and coaches re-edited a record that was right (prod, 19 Nov: 2,160
 * rostered teachers and principals hold more than one level). Longest value is 23 characters, inside
 * every field it lands in (row description 30, row metadata 80).
 */
function levelsLabelOf(bands = []) {
  return (Array.isArray(bands) ? bands : []).map((b) => BAND_WORD[b]).filter(Boolean).join(' + ');
}

/**
 * bd-r2uzg1.18.5 — the one label a picker prints for a person: 'Principal' for a principal, else every band.
 *
 * Manage teachers printed roleLabel, the Observe list printed the band, so after a coach changed a role
 * to Principal one screen said Principal and the other said PRIMARY. One function, every picker.
 * Accepts a shaped patch person (isPrincipal, levelsLabel), a leader-source row (is_principal,
 * levels_label) or a raw users row (role, teacher_level).
 */
function pickerLabelOf(p = {}) {
  if (!p) return '';
  if (p.isPrincipal || p.is_principal || p.role === 'principal') return PRINCIPAL_LABEL;
  return p.levelsLabel || p.levels_label || levelsLabelOf(bandsOf(p));
}

// ── shaping ────────────────────────────────────────────────────────────

const _norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');

/**
 * bd-43530 — the WHOLE name, taken from the fullest column that has one.
 *
 * `first_name` alone is a first name, which is what coaches were shown. But the
 * fix is NOT `first_name || ' ' || last_name`. Measured over all 9,362 NIETE
 * teachers+principals on 2026-08-31:
 *   · `name` is populated for 7,912 of them, `last_name` for only 4,304 — so
 *     preferring `name` yields a real multi-word name 7,912 times against 4,315
 *     for the concatenation.
 *   · 2,531 people have a ONE-WORD `first_name` and a MULTI-WORD `name`
 *     ('Irene' / NULL / 'Irene Khan'). Concatenating there returns "Irene" and
 *     leaves the bug exactly as reported.
 *   · 1,150 names have three parts ('Muhammad Kashif Rafique') — two columns
 *     cannot rebuild those at all.
 *   · 26 rows carry first/last but NO `name`, so the concatenation is a needed
 *     FALLBACK rather than dead code.
 *   · 513 carry nothing. They return null and the picker falls back to the
 *     phone — never the string "null".
 *
 * Longest full name on prod is 29 code points, so nothing clips at the picker's
 * 30-char title cap.
 */
function fullNameOf(r = {}) {
  return _norm(r.name)
    || [_norm(r.name), _norm(r.name)].filter(Boolean).join(' ')
    || null;
}

/**
 * The LAST step of that chain: a label for the 513 who carry no name at all.
 *
 * `fullNameOf` returning null is correct — we do not know what she is called,
 * and inventing a name is worse than showing none. But null then reached the
 * pickers as an EMPTY ROW TITLE, and an empty title is not "no name shown", it
 * is a person her coach cannot read, cannot search for and cannot tap. Reported
 * from the field as observations "not showing in the data": both sessions
 * existed, both reports were delivered, and the teacher was a blank line.
 * Measured 2026-09-07: 57 people with a school, 210 rows.
 *
 * So this is a LABEL, deliberately not a name:
 *   1. her real name, whenever the chain above resolves one;
 *   2. her role plus the last four digits of her phone. The coach already holds
 *      her number, it is unique inside a school, and the visit Flow already
 *      prints the full number on the second line of the same row — so this adds
 *      no exposure the coach did not already have. Four digits only; the whole
 *      number never appears here.
 *   3. her role plus the school, when there is no phone (a roster import can
 *      leave one out);
 *   4. role alone, said plainly, so the row is never blank.
 *
 * `name` itself is deliberately left null. `call-tools.repo.findRoster` reads
 * `name` and reads it ALOUD on a voice call, and never selects a phone on
 * purpose — so digits must not reach that field. This value travels on its own
 * property, and only the visual surfaces read it.
 *
 * Accepts EITHER shape: a raw `users` row or an already-shaped patch person.
 */
function displayNameOf(r = {}) {
  const real = fullNameOf(r);
  if (real) return real;
  const role = (r.isPrincipal || r.role === 'principal') ? 'Principal' : 'Teacher';
  const phone = _norm(r.phone == null ? r.phone_number : r.phone).replace(/\D/g, '');
  if (phone.length >= 4) return `${role} \u2026${phone.slice(-4)}`;
  const school = _norm(r.schoolName == null ? r.school_name : r.schoolName);
  if (school) return `${role} \u00b7 ${school}`;
  return `${role} (name not on file)`;
}

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
    name: fullNameOf(r),
    // Never empty. See displayNameOf — this is what the pickers render.
    displayName: displayNameOf(r),
    phone: r.phone_number || null,
    role: r.role || null,
    isPrincipal,
    roleLabel: isPrincipal ? PRINCIPAL_LABEL : '',
    schoolId: r.school_id || null,
    schoolName: r.school_name || null,
    emis: r.emis == null ? null : String(r.emis),
    // ONE band, for code that needs one value (toLeaderSourceRow.level, the voice-call roster).
    band: bandOf(r),
    // Every band, for a coach to read. Pickers print pickerLabelOf(), never `band`.
    levelsLabel: levelsLabelOf(bandsOf(r)),
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
    return String(a.displayName || a.name || '')
      .localeCompare(String(b.displayName || b.name || ''));
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
 *
 * bd-apnnh2.11: live accounts only. A fold retires the spare account
 * (deleted_at set, phone 'merged:<id>') and keeps its school and role, so
 * without the filter it comes back as a second, empty copy of the teacher.
 */
const PATCH_SQL = `
  SELECT u.id            AS user_id,
         u.phone_number,
         u.name,
         u.name,
         u.name,
         u.role,
         u.teacher_level,
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
   AND u.deleted_at IS NULL
  WHERE ls.leader_user_id = $1
`;

/** Every person this coach may observe. `query` is injected for testability. */
async function listPatch(query, leaderUserId) {
  const { rows } = await query(PATCH_SQL, [leaderUserId, [...PATCH_ROLES]]);
  return dedupePatch((rows || []).map(shapePatchRow));
}

// ── the supabase path (the bot; the dashboard uses PATCH_SQL) ──────────

/**
 * The same derivation over the supabase client, in three indexed round trips.
 *
 * Not one join because PostgREST cannot express `leader_schools -> schools` on
 * a text key. Each hop is a primary-key or indexed lookup and the widest coach
 * on production resolves 388 people, so this is small.
 */
/**
 * The school ids a coach holds, from `leader_schools` rows.
 *
 * One rule for "which schools are hers", used by every read path: the
 * `school_id` foreign key. `school_ext_id` stays what it is — a human-readable
 * label and the value the Flow round-trips — and is never parsed to find a
 * school.
 *
 * @param {Array<{school_id?: string}>} holdings
 * @returns {string[]} unique school ids, in the order first seen
 */
function schoolIdsForHoldings(holdings) {
  if (!Array.isArray(holdings)) return [];
  const out = [];
  const seen = new Set();
  for (const h of holdings) {
    const id = h && h.school_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * bd-33wxxi.4 — the school of a principal ON THE PRINCIPAL APP, or null. The switch is read with the portal's rule
 * (principal-app-switch: true, "true", or a list of users.id naming her; anything else, no row or a failed read is off),
 * and her own users row must say principal with a school_id. Fail-closed: null means today's roster (her leader_schools
 * holdings).
 */
async function principalAppSchoolId(supabase, userId) {
  if (!userId) return null;
  try {
    if (!(await isOnPrincipalApp(supabase, userId))) return null;
    const { data: me, error: meErr } = await supabase.from('users').select('role, school_id').eq('id', userId).maybeSingle();
    if (meErr || !me || String(me.role || '').trim().toLowerCase() !== 'principal') return null;
    return me.school_id || null;
  } catch (_) {
    return null;
  }
}

/**
 * bd-33wxxi.4 — a principal on the principal app observes HER OWN school (#55 P3): its teachers by users.school_id,
 * never herself and never another principal (a principal is not one of the school's teachers, bd-17v39c.4.15).
 */
async function ownSchoolPatch(supabase, principalId, schoolId) {
  const { data: schools } = await supabase.from('schools').select('id, name, emis').in('id', [schoolId]);
  const school = (schools || [])[0];
  if (!school) return [];
  const { data: people } = await supabase
    .from('users')
    .select('id, phone_number, name, role, school_id, teacher_level')
    .eq('school_id', schoolId)
    .in('role', ['teacher'])
    .is('deleted_at', null); // live accounts only, as every patch (bd-apnnh2.11)
  return dedupePatch((people || [])
    .filter((u) => String(u.id) !== String(principalId))
    .map((u) => shapePatchRow({ ...u, user_id: u.id, school_name: school.name, emis: school.emis })));
}

/**
 * A principal's own school (users.school_id) as one more holding, or null.
 *
 * Operator, 15 Nov: "a principal linked to a school (users.school_id or any leader_schools row) sees ALL teachers of
 * that school". On prod that day 477 of 522 principals held no leader_schools row (287 of them with a users.school_id
 * that has teachers), so their /observe picker was empty. Only a principal (config/role-features
 * observesOwnSchool): a coach's own users.school_id is never added. Null when they already hold that school,
 * when it has no schools row, and on any failed read: never a guess.
 *
 * Keyed the way a holding of that school would be: 'niete:' + EMIS, else the school's name, so the
 * patch rows (toLeaderSourceRow) and the school list agree on the key.
 */
async function ownSchoolHolding(supabase, leaderUserId, held = []) {
  if (!leaderUserId) return null;
  try {
    const { observesOwnSchool } = require('../../config/role-features');
    const { data: me, error } = await supabase.from('users').select('role, school_id').eq('id', leaderUserId).maybeSingle();
    if (error || !me || !me.school_id || !observesOwnSchool(me)) return null;
    if ((held || []).some((h) => h && h.school_id === me.school_id)) return null;
    const { data: school, error: sErr } = await supabase.from('schools').select('id, name, emis').eq('id', me.school_id).maybeSingle();
    if (sErr || !school) return null;
    const emis = school.emis == null || String(school.emis).trim() === '' ? null : String(school.emis).trim();
    const key = emis ? `niete:${emis}` : (_norm(school.name) || null);
    if (!key || (held || []).some((h) => h && h.school_ext_id === key)) return null;
    return { school_ext_id: key, school_id: school.id, school_name: school.name || null, emis, own: true };
  } catch (_) {
    return null;
  }
}

/**
 * The schools a leader observes in: their leader_schools holdings, then (a principal only) their own
 * school. One rule for the picker's school list (leader-source) and its people (listPatchViaSupabase below), so the
 * two cannot disagree. Rows: { school_ext_id, school_id, school_name, emis, own? }. A failed holdings read is [].
 */
async function leaderHoldings(supabase, leaderUserId) {
  const { data, error } = await supabase
    .from('leader_schools').select('school_ext_id, school_id, school_name, emis').eq('leader_user_id', leaderUserId);
  const held = error ? [] : (data || []);
  const own = await ownSchoolHolding(supabase, leaderUserId, held);
  return own ? [...held, own] : held;
}

async function listPatchViaSupabase(supabase, leaderUserId, schoolExtId = null) {
  // bd-33wxxi.4 — a principal on the principal app: her own school, whatever she holds (one school, so no filter).
  const ownSchool = await principalAppSchoolId(supabase, leaderUserId);
  if (ownSchool) return ownSchoolPatch(supabase, leaderUserId, ownSchool);

  // Holdings, plus a principal's own school.
  const mine = await leaderHoldings(supabase, leaderUserId);

  // bd-5n1a2: '' must mean "no filter". A schedule row carrying school_ext_id=''
  // once turned into a zero-row roster and silently unbound a picked teacher.
  const wanted = (schoolExtId == null || schoolExtId === '')
    ? (mine || [])
    : (mine || []).filter((r) => r.school_ext_id === schoolExtId);
  if (!wanted.length) return [];

  // The FK, not a string parse. This used to split school_ext_id on
  // ':' and match the tail against schools.emis, which disagreed with PATCH_SQL
  // in this same file (that one joins on school_id). A holding could satisfy
  // one and fail the other, and the picker then returned "no matches" with no
  // error anywhere — a silent empty roster.
  //
  // Measured on production: 482 of 487 holdings already carry school_id and
  // none of them dangles, so keying on the FK strictly improves on the parse.
  // The 5 without one are test:* fixtures; they drop out, which is correct — a
  // holding that cannot name its school is not a holding.
  const schoolIds = schoolIdsForHoldings(wanted);
  if (!schoolIds.length) return [];
  const { data: schools } = await supabase.from('schools').select('id, name, emis').in('id', schoolIds);
  const byId = new Map((schools || []).map((s) => [s.id, s]));
  if (!byId.size) return [];

  // bd-97daxo.29: the holding key each school was reached by. A school with no EMIS (GB Hoto, Deosai, the Rumi QA
  // test schools) is keyed by its name in leader_schools, and toLeaderSourceRow falls back to this key.
  const holdingKey = new Map();
  for (const h of wanted) if (h && h.school_id && h.school_ext_id && !holdingKey.has(h.school_id)) holdingKey.set(h.school_id, h.school_ext_id);

  const { data: people } = await supabase
    .from('users')
    .select('id, phone_number, name, role, school_id, teacher_level')
    .in('school_id', [...byId.keys()])
    .in('role', [...PATCH_ROLES])
    .is('deleted_at', null); // live accounts only, as PATCH_SQL (bd-apnnh2.11)

  return dedupePatch((people || []).map((u) => {
    const s = byId.get(u.school_id) || {};
    return {
      ...shapePatchRow({ ...u, user_id: u.id, school_name: s.name, emis: s.emis }),
      schoolExtId: holdingKey.get(u.school_id) || null,
    };
  }));
}

/**
 * A patch person in the shape `leader-source` and the visit Flow already read.
 *
 * `teacher_ext_id` is the PHONE. 980 of 992 live observation_schedules rows and
 * 8,043 of 8,057 old roster rows already key on it, so emitting the phone keeps
 * scheduling continuous across the switch. The 12 `name:` slug schedules do not
 * resolve and are the known cost.
 *
 * `level` stays uppercase because every consumer was written against the old
 * column's PRIMARY/MIDDLE/HIGH.
 */
function toLeaderSourceRow(p = {}) {
  return {
    teacher_ext_id: p.phone || null,
    // The LABEL, not the name: a person with no name on file must still be a
    // readable, tappable row for her coach rather than a blank title.
    teacher_name: p.displayName || displayNameOf(p) || null,
    teacher_phone_e164: p.phone || null,
    // bd-97daxo.29: the portal's rule (bd-97daxo.22, leader-patch): COALESCE('niete:' || emis, the coach's holding
    // key). 'niete:' + a null EMIS left an EMIS-less school's teachers under null, so the /observe school list said
    // "0 teachers" for GB Hoto and Deosai while tapping the school listed them.
    school_ext_id: schoolKeyOf(p),
    level: p.band ? String(p.band).toUpperCase() : null,
    // bd-r2uzg1.18.5: every band, for display ('Primary + Middle + High'); `level` above stays one value.
    levels_label: p.levelsLabel || '',
    is_principal: !!p.isPrincipal,
  };
}

module.exports = {
  PATCH_ROLES,
  listPatchViaSupabase,
  leaderHoldings,
  principalAppSchoolId,
  schoolKeyOf,
  toLeaderSourceRow,
  PATCH_SQL,
  bandOf,
  schoolIdsForHoldings,
  bandsOf,
  levelsLabelOf,
  pickerLabelOf,
  PRINCIPAL_LABEL,
  shapePatchRow,
  fullNameOf,
  displayNameOf,
  dedupePatch,
  listPatch,
};
