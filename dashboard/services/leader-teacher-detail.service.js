/**
 * bd-2388 — Leader → single teacher detail.
 *
 * SECURITY: a leader may only view a teacher in THEIR patch. This resolver first
 * proves membership (the teacher's Rumi user must appear in the leader's
 * leader_teachers rows) and returns null otherwise — the endpoint 404s. Only
 * after membership is proven do we fetch that teacher's coaching/LP/reading data,
 * so a leader can never enumerate arbitrary teachers by guessing user ids.
 *
 * query() is injected (sig: (sql, params) => Promise<{rows}>) → unit-testable.
 */

const { getOverall } = require('./coaching-frameworks.service');
// bd-2671's TERMINAL, imported rather than respelled. A leader observation never
// reaches status='completed' — the coach submits her review and observer_review_complete
// IS the end state — so this service's own `status = 'completed'` filter hid 629 of
// 2,625 observations (24%) from the very drawer the teacher list links to. Every one of
// those 629 carries analysis_data; they were not degraded, they were absent. Two
// spellings of "finished" is how they diverged, so there is one.
const { TERMINAL } = require('./leader-patch.service');

// Membership + identity in one shot. Empty result ⇒ not in this leader's patch.
// Membership is DERIVED: she is in this leader's patch iff her school is one
// of his. The stored roster used to answer this and disagreed with
// users.school_id on 230 rows, which meant a leader could open a teacher the
// schools say is not his — or be refused one that is.
const MEMBERSHIP_SQL = `
  SELECT u.id, u.name, u.phone_number
  FROM leader_schools ls
  JOIN schools s
    ON ls.school_id = s.id OR 'niete:' || s.emis = ls.school_ext_id
  JOIN users u
    ON u.school_id = s.id
   AND u.role IN ('teacher', 'principal')
  WHERE ls.leader_user_id = $1 AND u.id = $2
  LIMIT 1
`;

// bd-60117 — the same proof for a PRINCIPAL, whose link to a school is her own
// users.school_id rather than a leader_schools assignment. Without this she was
// refused every teacher in her own school, herself included: the drawer 404'd
// while the roster behind it sat empty, both from this one missing entry point.
//
// Just as strict, in the same shape: she is let through iff the teacher's school
// is HER school. The role guard is part of the boundary, not decoration — drop
// it and any leader-family user carrying a school_id would silently be scoped to
// that one school instead of the patch they actually hold.
const PRINCIPAL_MEMBERSHIP_SQL = `
  SELECT u.id, u.name, u.phone_number
  FROM users me
  JOIN users u
    ON u.school_id = me.school_id
   AND u.role IN ('teacher', 'principal')
  WHERE me.id = $1
    AND me.role = 'principal'
    AND me.school_id IS NOT NULL
    AND u.id = $2
  LIMIT 1
`;

/** Which membership proof applies, given the viewer's role. */
function membershipSqlFor(role) {
  const r = role == null ? null : String(role).trim().toLowerCase();
  return r === 'principal' ? PRINCIPAL_MEMBERSHIP_SQL : MEMBERSHIP_SQL;
}

const SESSIONS_SQL = `
  SELECT id, created_at, analysis_data
  FROM coaching_sessions
  WHERE user_id = $1 AND status IN ${TERMINAL} AND analysis_data IS NOT NULL
  ORDER BY created_at DESC
`;

const COUNTS_SQL = `
  SELECT
    (SELECT count(*) FROM lesson_plans      WHERE user_id = $1) AS lesson_plans,
    (SELECT count(*) FROM reading_assessments WHERE user_id = $1) AS reading_assessments
`;

/**
 * @param {(sql: string, params: any[]) => Promise<{rows: object[]}>} query
 * @param {string} leaderUserId   portal session user id
 * @param {string} teacherUserId  Rumi users.id of the teacher being viewed
 * @param {{role?: string}} [opts]  viewer's users.role — picks the membership
 *   proof (bd-60117). Omitted ⇒ the coach proof, exactly as before.
 * @returns {Promise<object|null>}  detail, or null if the teacher isn't in the leader's patch
 */
async function getPatchTeacherDetail(query, leaderUserId, teacherUserId, opts = {}) {
  const { rows: member } = await query(membershipSqlFor(opts.role), [leaderUserId, teacherUserId]);
  if (!member || member.length === 0) return null;   // not in patch → caller 404s
  const t = member[0];

  const [{ rows: sessionRows }, { rows: countRows }] = await Promise.all([
    query(SESSIONS_SQL, [teacherUserId]),
    query(COUNTS_SQL, [teacherUserId]),
  ]);

  const sessions = (sessionRows || []).map((s) => {
    const o = getOverall(s.analysis_data);
    return {
      id: s.id,
      date: s.created_at,
      score: o && o.percentage != null ? o.percentage : null,
      points: o ? o.points : null,
      maxPoints: o ? o.maxPoints : null,
    };
  });
  const counts = (countRows && countRows[0]) || {};

  return {
    teacher: { rumiUserId: t.id, name: t.name, phone: t.phone_number, onRumi: true },
    stats: {
      coachingSessions: sessions.length,
      lessonPlans: Number(counts.lesson_plans) || 0,
      readingAssessments: Number(counts.reading_assessments) || 0,
      lastScore: sessions.length ? sessions[0].score : null,
    },
    sessions,
  };
}

module.exports = {
  getPatchTeacherDetail,
  membershipSqlFor,
  MEMBERSHIP_SQL,
  PRINCIPAL_MEMBERSHIP_SQL,
  SESSIONS_SQL,
  COUNTS_SQL,
};
