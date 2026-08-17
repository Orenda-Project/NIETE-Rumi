/**
 * bd-88krt — coach self-service: edit a visit, and own your school list.
 *
 * Riffat (HITL R38/R39/R41). R41's root cause was not a missing feature but a
 * missing TRANSACTION: giving a coach a school is a two-table write
 * (leader_schools + leader_teachers) performed by hand, so half of it gets
 * forgotten. Live proof: niete:273 sat in Syeda's leader_schools with 0
 * teachers while all 8 of its teachers were still mapped to coach Rabia, and
 * niete:273 was never removed from Rabia either. This service makes the pair
 * of writes one operation a coach can perform herself.
 *
 * Facts from the live DB (2026-08-17) that shaped the rules below:
 *   · `schools` (465 rows) is the searchable universe; `leader_teachers`
 *     (7,149 rows over 412 schools) is the de-facto school->teacher roster —
 *     there is no separate roster table (checked: teachers, school_teachers,
 *     teacher_roster all absent).
 *   · 139 (school,teacher) pairs are already held by more than one coach, so
 *     co-assignment is NORMAL and must never be treated as an error.
 *   · 51 master schools have no coach and therefore no teacher rows at all.
 *     Adding one of those can map nobody — the coach is told so explicitly,
 *     because silently handing her an empty school is exactly the bug (R41)
 *     this service exists to prevent.
 *
 * `query` is injected ((sql, params) => Promise<{rows}>) like every leader-*
 * service, so this is unit-testable without a live DB.
 */

const SLOTS = ['09:00', '11:30', '14:00'];

// Both tables carry CHECK (source = 'niete_ict') — verified against the live
// schema, and the reason a 'coach_self_assign' value fails with a 23514 CHECK
// violation on every insert. Unit tests inject `query`, so they cannot catch
// this; only a real write does. Widening the constraint to record provenance
// (who mapped this row) needs a migration and is proposed separately.
const ROW_SOURCE = 'niete_ict';
const TEACHER_SEARCH_CAP = 20;   // RadioButtonsGroup ceiling (Meta Flow JSON)
const MIN_TERM = 2;

// ── SQL ────────────────────────────────────────────────────────────────

const OWNED_SCHEDULE_SQL = `
  SELECT id, status, leader_user_id FROM observation_schedules WHERE id = $1 LIMIT 1
`;

const EDIT_SCHEDULE_SQL = `
  UPDATE observation_schedules
  SET scheduled_for = $3, scheduled_slot = $4, updated_at = now()
  WHERE id = $1 AND leader_user_id = $2 AND status = 'upcoming'
  RETURNING id, scheduled_for, scheduled_slot
`;

// The searchable universe, annotated with what this coach already has and
// whether a roster exists to map. One round trip, no N+1.
const SEARCH_SCHOOLS_SQL = `
  SELECT s.school_ext_id, s.school_name, s.emis,
         COALESCE(t.n, 0)  AS teacher_count,
         COALESCE(m.n, 0)  AS assigned_to_me
  FROM (
    SELECT 'niete:' || emis AS school_ext_id, name AS school_name, emis
    FROM schools WHERE is_active IS NOT FALSE
  ) s
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT teacher_phone_e164) AS n
    FROM leader_teachers lt WHERE lt.school_ext_id = s.school_ext_id
  ) t ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM leader_schools ls
    WHERE ls.school_ext_id = s.school_ext_id AND ls.leader_user_id = $1
  ) m ON true
  WHERE s.school_name ILIKE $2 OR s.emis ILIKE $2
  ORDER BY s.school_name ASC
  LIMIT 25
`;

const MASTER_SCHOOL_SQL = `
  SELECT 'niete:' || emis AS school_ext_id, name AS school_name, emis
  FROM schools WHERE 'niete:' || emis = $1 LIMIT 1
`;

const MINE_SQL = `
  SELECT school_ext_id FROM leader_schools
  WHERE leader_user_id = $1 AND school_ext_id = $2 LIMIT 1
`;

// How many teachers THIS coach already has at that school. Zero, on a school
// she already owns, is precisely the R41 breakage — so the add repairs it.
const MY_TEACHER_COUNT_SQL = `
  SELECT count(*) AS n FROM leader_teachers
  WHERE leader_user_id = $1 AND school_ext_id = $2
`;

// The roster for a school, deduped by phone across whichever coaches hold it.
const ROSTER_SQL = `
  SELECT DISTINCT ON (teacher_phone_e164)
         teacher_ext_id, teacher_name, teacher_phone_e164, level
  FROM leader_teachers
  WHERE school_ext_id = $1 AND teacher_phone_e164 IS NOT NULL
  ORDER BY teacher_phone_e164, teacher_name
`;

const INSERT_SCHOOL_SQL = `
  INSERT INTO leader_schools (leader_user_id, school_ext_id, school_name, emis, source)
  VALUES ($1, $2, $3, $4, '${ROW_SOURCE}')
  RETURNING id
`;

const INSERT_TEACHER_SQL = `
  INSERT INTO leader_teachers
    (leader_user_id, school_ext_id, teacher_ext_id, teacher_name, teacher_phone_e164, level, source)
  VALUES ($1, $2, $3, $4, $5, $6, '${ROW_SOURCE}')
  RETURNING id
`;

const DELETE_SCHOOL_SQL = `
  DELETE FROM leader_schools WHERE leader_user_id = $1 AND school_ext_id = $2 RETURNING id
`;

const DELETE_TEACHERS_SQL = `
  DELETE FROM leader_teachers WHERE leader_user_id = $1 AND school_ext_id = $2 RETURNING id
`;

const SEARCH_TEACHERS_SQL = `
  SELECT lt.teacher_ext_id, lt.teacher_name, lt.teacher_phone_e164, lt.school_ext_id,
         s.school_name
  FROM leader_teachers lt
  LEFT JOIN LATERAL (
    SELECT school_name FROM leader_schools ls
    WHERE ls.school_ext_id = lt.school_ext_id LIMIT 1
  ) s ON true
  WHERE lt.leader_user_id = $1 AND lt.teacher_name ILIKE $2
  ORDER BY lt.teacher_name ASC
  LIMIT ${TEACHER_SEARCH_CAP}
`;

// ── helpers ────────────────────────────────────────────────────────────

function validDate(value) {
  if (!value || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function requireTerm(term) {
  const t = String(term || '').trim();
  if (t.length < MIN_TERM) throw new Error(`Type at least two letters to search`);
  return `%${t}%`;
}

// ── R39 · edit a scheduled visit ───────────────────────────────────────

/**
 * Move an upcoming visit. A 'done' row is refused outright: since bd-2668 those
 * rows ARE the record of who was observed, so editing one would rewrite history.
 */
async function editSchedule(query, leaderUserId, scheduleId, input = {}, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const { date, slot } = input;
  if (!validDate(date)) throw new Error('Invalid date — expected YYYY-MM-DD');
  if (date < today) throw new Error('That date is in the past');
  if (slot && !SLOTS.includes(slot)) throw new Error('Unknown time slot');

  const { rows } = await query(OWNED_SCHEDULE_SQL, [scheduleId]);
  const row = rows && rows[0];
  if (!row || row.leader_user_id !== leaderUserId) throw new Error('Schedule not found');
  if (row.status === 'done') throw new Error('That visit is already completed and cannot be edited');
  if (row.status !== 'upcoming') throw new Error('Schedule not found');

  const { rows: done } = await query(EDIT_SCHEDULE_SQL, [scheduleId, leaderUserId, date, slot || null]);
  if (!done || !done[0]) throw new Error('Schedule not found');
  return { id: done[0].id, date, slot: slot || null, updated: true };
}

// ── R38 · own your school list ─────────────────────────────────────────

async function searchSchools(query, leaderUserId, term) {
  const like = requireTerm(term);
  const { rows } = await query(SEARCH_SCHOOLS_SQL, [leaderUserId, like]);
  return (rows || []).map((r) => ({
    schoolExtId: r.school_ext_id,
    schoolName: r.school_name,
    emis: r.emis,
    teacherCount: Number(r.teacher_count) || 0,
    // 51 master schools have no roster at all — surface it, never hide it
    hasRoster: (Number(r.teacher_count) || 0) > 0,
    alreadyMine: Number(r.assigned_to_me) > 0,
  }));
}

/**
 * Add a school AND map its roster in the same call. Idempotent: a coach tapping
 * "add" twice must not double her teacher list.
 */
async function addSchool(query, leaderUserId, schoolExtId) {
  const { rows: master } = await query(MASTER_SCHOOL_SQL, [schoolExtId]);
  const school = master && master[0];
  if (!school) throw new Error('That school was not found in the school list');

  const { rows: mine } = await query(MINE_SQL, [leaderUserId, schoolExtId]);
  const alreadyMine = !!(mine && mine[0]);

  // A school she already owns, with none of her teachers on it, is the R41
  // breakage itself. Refusing as "already mine" would leave the bug in place,
  // so the add doubles as a repair: map the roster, don't duplicate the school.
  let repairing = false;
  if (alreadyMine) {
    const { rows: c } = await query(MY_TEACHER_COUNT_SQL, [leaderUserId, schoolExtId]);
    const mineCount = Number((c && c[0] && c[0].n) || 0);
    if (mineCount > 0) {
      return { schoolExtId, schoolName: school.school_name, alreadyMine: true, teachersMapped: 0 };
    }
    repairing = true;
  }

  const { rows: roster } = await query(ROSTER_SQL, [schoolExtId]);
  if (!repairing) {
    await query(INSERT_SCHOOL_SQL, [leaderUserId, schoolExtId, school.school_name, school.emis]);
  }

  let mapped = 0;
  for (const t of roster || []) {
    // Names and phones come from the ROSTER, never from the caller.
    await query(INSERT_TEACHER_SQL, [
      leaderUserId, schoolExtId, t.teacher_ext_id || t.teacher_phone_e164,
      t.teacher_name || null, t.teacher_phone_e164, t.level || null,
    ]);
    mapped += 1;
  }

  const out = {
    schoolExtId, schoolName: school.school_name, alreadyMine, teachersMapped: mapped,
  };
  if (repairing) out.repaired = true;
  if (!mapped) {
    out.warning = 'This school has no teacher list yet, so no teachers were added. '
      + 'Tell the team and they will load its roster.';
  }
  return out;
}

/** Remove a school and ONLY this coach's teacher rows for it. */
async function removeSchool(query, leaderUserId, schoolExtId) {
  const { rows: mine } = await query(MINE_SQL, [leaderUserId, schoolExtId]);
  if (!mine || !mine[0]) throw new Error('That school is not in your list');
  const { rows: teachers } = await query(DELETE_TEACHERS_SQL, [leaderUserId, schoolExtId]);
  await query(DELETE_SCHOOL_SQL, [leaderUserId, schoolExtId]);
  return { schoolExtId, removed: true, teachersRemoved: (teachers || []).length };
}

/**
 * Search the coach's OWN teachers. Meta's Dropdown has no built-in search
 * (max 200 options, no filter field), so search is a server-side query driven
 * by a TextInput + data_exchange — and the result set is capped at the
 * RadioButtonsGroup ceiling so a Flow screen can always render it.
 */
async function searchTeachers(query, leaderUserId, term) {
  const like = requireTerm(term);
  const { rows } = await query(SEARCH_TEACHERS_SQL, [leaderUserId, like]);
  return (rows || []).slice(0, TEACHER_SEARCH_CAP).map((r) => ({
    teacherExtId: r.teacher_ext_id,
    name: r.teacher_name,
    phone: r.teacher_phone_e164,
    schoolExtId: r.school_ext_id,
    schoolName: r.school_name || null,
  }));
}

module.exports = {
  editSchedule, searchSchools, addSchool, removeSchool, searchTeachers,
  SLOTS, TEACHER_SEARCH_CAP, validDate, INSERT_SQL_SOURCE: ROW_SOURCE,
};
