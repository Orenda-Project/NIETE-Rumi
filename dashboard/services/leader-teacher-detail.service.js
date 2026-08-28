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

// Membership + identity in one shot. Empty result ⇒ not in this leader's patch.
// Membership is DERIVED: she is in this leader's patch iff her school is one
// of his. The stored roster used to answer this and disagreed with
// users.school_id on 230 rows, which meant a leader could open a teacher the
// schools say is not his — or be refused one that is.
const MEMBERSHIP_SQL = `
  SELECT u.id, u.first_name, u.phone_number
  FROM leader_schools ls
  JOIN schools s
    ON ls.school_id = s.id OR 'niete:' || s.emis = ls.school_ext_id
  JOIN users u
    ON u.school_id = s.id
   AND u.role IN ('teacher', 'principal')
  WHERE ls.leader_user_id = $1 AND u.id = $2
  LIMIT 1
`;

const SESSIONS_SQL = `
  SELECT id, created_at, analysis_data
  FROM coaching_sessions
  WHERE user_id = $1 AND status = 'completed' AND analysis_data IS NOT NULL
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
 * @returns {Promise<object|null>}  detail, or null if the teacher isn't in the leader's patch
 */
async function getPatchTeacherDetail(query, leaderUserId, teacherUserId) {
  const { rows: member } = await query(MEMBERSHIP_SQL, [leaderUserId, teacherUserId]);
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
    teacher: { rumiUserId: t.id, name: t.first_name, phone: t.phone_number, onRumi: true },
    stats: {
      coachingSessions: sessions.length,
      lessonPlans: Number(counts.lesson_plans) || 0,
      readingAssessments: Number(counts.reading_assessments) || 0,
      lastScore: sessions.length ? sessions[0].score : null,
    },
    sessions,
  };
}

module.exports = { getPatchTeacherDetail, MEMBERSHIP_SQL, SESSIONS_SQL, COUNTS_SQL };
