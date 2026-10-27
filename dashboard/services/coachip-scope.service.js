'use strict';
/**
 * bd-sex15q.13 — COACHIP's scope service (SPEC v2 §1, API.md §4): which schools, teachers and coaches a caller may see.
 * Computed once per request by the router's coachipScope guard and never cached across requests (B3).
 *
 *   coachScope(uid)       the coach's real schools: leader_schools matched to schools by school_id OR by the
 *                         'niete:' || emis ext id (the house join, leader-patch.service.js PATCH_TEACHERS_SQL), the link not
 *                         name_match_quality 'test', the school in one of the six sectors, not is_probable_test, not a
 *                         'NIETE…' school; and their live (not deleted), non-test teachers. null with no real school (S1
 *                         no_scope). Teachers are held as HMAC keys only (teacherKeys, teacherSchool): never users.id.
 *   rmScope(uid, sector)  the sector's real schools; the live non-test coach-role users holding one (not the RM); the RDF
 *                         roster's coaches for the sector (app_settings analytics_rdf_coaches); its teachers; the schools no
 *                         coach holds. null without a sector. The sector comes from rmSectorFor (feature-flags), read by the
 *                         router's switch guard and passed in, so the flag is read once per request.
 *   inScope(scope, sid)   the session's teacher, at their CURRENT school (E7: a teacher who moved counts at the new school,
 *                         stated on the method sheet), is one of the scope's teachers.
 *   circleAllows(rm, mid) the moment is in this sector's Friday circle for the current Karachi week (coachip_circle_items,
 *                         the stored predicate, B3).
 *
 * The teacher roster is the house definition (leader-patch) narrowed to role 'teacher': principals are not coached
 * teachers here, and a COACHIP scope never selects a name.
 */
const { SECTORS, parseCoaches, LIST_KEYS } = require('../lib/analytics-lists');
const S = require('./coachip-shapes');

const SCHOOL_JOIN = "(ls.school_id = s.id OR 'niete:' || s.emis = ls.school_ext_id)";
const REAL_SCHOOL = "NOT s.is_probable_test AND s.name NOT LIKE 'NIETE%'";
const LIVE_TEACHER = "u.role = 'teacher' AND u.deleted_at IS NULL AND NOT COALESCE(u.is_test_user, false)";

/**
 * @param {{ query: Function, codes: object, now?: () => Date }} deps  codes: createCoachipCodes(...) (teacherKey)
 */
function createCoachipScope({ query, codes, now = () => new Date() }) {
  async function teachersAt(schoolIds) {
    if (!schoolIds.length) return [];
    const { rows } = await query(
      `SELECT u.id, u.school_id FROM users u WHERE ${LIVE_TEACHER} AND u.school_id = ANY($1::uuid[])`,
      [schoolIds],
    );
    return rows;
  }

  async function coachScope(userId) {
    const { rows } = await query(
      `SELECT DISTINCT s.id
         FROM leader_schools ls JOIN schools s ON ${SCHOOL_JOIN}
        WHERE ls.leader_user_id = $1 AND ls.name_match_quality IS DISTINCT FROM 'test'
          AND s.region = ANY($2::text[]) AND ${REAL_SCHOOL}`,
      [userId, SECTORS],
    );
    if (!rows.length) return null;
    const schoolIds = rows.map((r) => r.id);
    const teachers = await teachersAt(schoolIds);
    const teacherSchool = new Map();
    for (const t of teachers) {
      const key = codes.teacherKey(t.id);
      if (key) teacherSchool.set(key, t.school_id);
    }
    return {
      schoolIds,
      teacherKeys: [...teacherSchool.keys()],
      teacherSchool,                  // server only: key → current school
      teacherCount: teacherSchool.size,
      schoolCount: schoolIds.length,
    };
  }

  async function rmScope(userId, sector) {
    if (!userId || typeof sector !== 'string' || !SECTORS.includes(sector)) return null;
    // REAL_SCHOOL spelled out: tests/setup/raw-sql-schools-columns.test.js reads a schools-only query's identifiers as columns
    const schools = await query(
      `SELECT s.id FROM schools AS s WHERE s.region = $1 AND NOT s.is_probable_test AND s.name NOT LIKE 'NIETE%'`, [sector],
    );
    const schoolIds = schools.rows.map((r) => r.id);
    const held = schoolIds.length ? await query(
      `SELECT DISTINCT u.id AS coach_user_id, s.id AS school_id
         FROM leader_schools ls JOIN schools s ON ${SCHOOL_JOIN} JOIN users u ON u.id = ls.leader_user_id
        WHERE s.id = ANY($1::uuid[]) AND ls.name_match_quality IS DISTINCT FROM 'test'
          AND u.role = 'coach' AND u.deleted_at IS NULL AND NOT COALESCE(u.is_test_user, false) AND u.id <> $2`,
      [schoolIds, userId],
    ) : { rows: [] };
    const coachUserIds = [...new Set(held.rows.map((r) => r.coach_user_id))];
    const heldSchools = new Set(held.rows.map((r) => r.school_id));
    const teachers = await teachersAt(schoolIds);
    const roster = await query('SELECT value FROM app_settings WHERE key = $1', [LIST_KEYS.coaches]);
    const parsed = roster.rows[0] ? parseCoaches(roster.rows[0].value) : null;
    const rosterCoachUserIds = parsed
      ? [...new Set(parsed.coaches.filter((c) => c.sector === sector).flatMap((c) => c.userIds))].filter((id) => id !== userId)
      : [];
    return {
      sector,
      schoolIds,
      coachUserIds,
      rosterCoachUserIds,
      teacherCount: teachers.length,
      unassignedSchoolCount: schoolIds.filter((id) => !heldSchools.has(id)).length,
    };
  }

  async function inScope(scope, sessionId) {
    if (!scope || !S.isUuid(sessionId)) return false;
    const { rows } = await query(
      `SELECT u.id, u.school_id FROM coaching_sessions cs JOIN users u ON u.id = cs.user_id WHERE cs.id = $1 AND ${LIVE_TEACHER}`,
      [sessionId],
    );
    if (!rows[0] || !scope.schoolIds.includes(rows[0].school_id)) return false;   // the CURRENT school, read now
    const key = codes.teacherKey(rows[0].id);
    return !!key && scope.teacherSchool instanceof Map && scope.teacherSchool.has(key);
  }

  async function circleAllows(rm, momentId) {
    if (!rm || !rm.sector || !S.isUuid(momentId)) return false;
    const { rows } = await query(
      'SELECT 1 FROM coachip_circle_items WHERE sector = $1 AND week_start = $2::date AND moment_id = $3 LIMIT 1',
      [rm.sector, S.karachiMonday(now()), momentId],
    );
    return rows.length > 0;
  }

  return { coachScope, rmScope, inScope, circleAllows };
}

module.exports = { createCoachipScope };
