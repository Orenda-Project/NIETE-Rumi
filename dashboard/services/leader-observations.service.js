/**
 * bd-2455 — Leader "Observations" resolver.
 *
 * Surfaces the coach's /observe world on the portal in one payload:
 *   upcoming        — observation_schedules status='upcoming' (date-ordered,
 *                     overdue-flagged), the same rows the bot's "My schedule"
 *                     screen lists.
 *   pendingDebriefs — the bot's exact listPendingDebriefs semantics
 *                     (observer_review_complete + debrief_status='pending').
 *   completed       — past observations: terminal status, or review-complete
 *                     with the debrief done. In-flight ('confirmed', queue
 *                     states) and 'failed' rows appear in NEITHER list.
 *
 * Teacher identity on a session is its OWNER (user_id — the visit picker binds
 * the observed teacher as owner). A legacy unbound capture is owned by the
 * observer; its name is returned null so the UI never labels the coach as the
 * observed teacher.
 *
 * `query` is injected ((sql, params) => Promise<{rows}>) like every leader-*
 * service, so this is unit-testable without a live DB.
 */

const { getOverall } = require('./coaching-frameworks.service');

const UPCOMING_SQL = `
  SELECT id, teacher_name, school_name, school_ext_id, teacher_ext_id,
         scheduled_for, scheduled_slot, created_at
  FROM observation_schedules
  WHERE leader_user_id = $1 AND status = 'upcoming'
  ORDER BY scheduled_for ASC, created_at ASC
`;

// bd-2670: the observed teacher is named from the linked schedule when there is
// one. LATERAL + LIMIT 1 is deliberate: markDone() stamps session_id on EVERY
// matching 'upcoming' row for that coach×teacher×school, and live data already
// has duplicate schedules for one teacher — a plain LEFT JOIN would duplicate
// the observation in the list.
const SESSIONS_SQL = `
  SELECT c.id, c.created_at, c.status, c.debrief_status, c.analysis_data,
         c.report_pdf_url, c.user_id, c.observer_user_id,
         u.first_name AS teacher_first_name,
         os.teacher_name  AS sched_teacher_name,
         os.school_name   AS sched_school_name,
         os.school_ext_id AS sched_school_ext_id
  FROM coaching_sessions c
  LEFT JOIN users u ON u.id = c.user_id
  LEFT JOIN LATERAL (
    SELECT s.teacher_name, s.school_name, s.school_ext_id
    FROM observation_schedules s
    WHERE s.session_id = c.id
    ORDER BY s.updated_at DESC NULLS LAST
    LIMIT 1
  ) os ON true
  WHERE c.observer_user_id = $1 AND c.observation_type = 'leader_observation'
  ORDER BY c.created_at DESC
`;

/**
 * The EMIS code coaches read is the suffix of school_ext_id ('niete:509' →
 * '509'). Riffat asked for it because teachers share names across schools.
 */
function emisOf(schoolExtId) {
  if (!schoolExtId) return null;
  const s = String(schoolExtId);
  const code = s.includes(':') ? s.slice(s.lastIndexOf(':') + 1) : s;
  return code.trim() || null;
}

function isoDay(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function shapeSchedule(r, today) {
  const scheduledFor = isoDay(r.scheduled_for);
  return {
    id: r.id,
    teacherName: r.teacher_name || null,
    schoolName: r.school_name || null,
    schoolExtId: r.school_ext_id || null,
    teacherExtId: r.teacher_ext_id || null,
    scheduledFor,
    scheduledSlot: r.scheduled_slot || null,
    overdue: !!(scheduledFor && today && scheduledFor < today),
  };
}

function shapeSession(r) {
  const overall = r.analysis_data ? getOverall(r.analysis_data) : null;
  // A legacy unbound capture is owned by the observer — never show the coach's
  // own name as the observed teacher.
  const selfOwned = r.user_id && r.observer_user_id && r.user_id === r.observer_user_id;

  // bd-2670: identity in priority order. `users.first_name` alone left 78% of
  // live rows reading "Unassigned", because most captures are ad-hoc and the
  // row ends up owned by the coach.
  //   1. the schedule the coach booked (also carries school + EMIS)
  //   2. the name she typed/picked when sending the report
  //   3. the bound teacher's own account
  const delivered = ((r.analysis_data || {}).teacher_delivery || {}).teacher_name;
  const teacherName =
    (r.sched_teacher_name || null)
    || (delivered || null)
    || (selfOwned ? null : (r.teacher_first_name || null));

  return {
    id: r.id,
    createdAt: r.created_at || null,
    teacherName,
    teacherUserId: selfOwned ? null : (r.user_id || null),
    schoolName: r.sched_school_name || null,
    emis: emisOf(r.sched_school_ext_id),
    status: r.status,
    debriefStatus: r.debrief_status || null,
    score: overall && overall.percentage != null ? overall.percentage : null,
    reportPdfUrl: r.report_pdf_url || null,
  };
}

function isPendingDebrief(r) {
  return r.status === 'observer_review_complete' && r.debrief_status === 'pending';
}

function isCompleted(r) {
  if (r.status === 'completed') return true;
  return r.status === 'observer_review_complete' && r.debrief_status !== 'pending';
}

/**
 * @param {(sql: string, params: any[]) => Promise<{rows: object[]}>} query
 * @param {string} leaderUserId portal session user id
 * @param {{today?: string}} opts today as YYYY-MM-DD (defaults to now, UTC)
 * @returns {Promise<{upcoming: object[], pendingDebriefs: object[], completed: object[]}>}
 */
async function getLeaderObservations(query, leaderUserId, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  try {
    const [schedules, sessions] = await Promise.all([
      query(UPCOMING_SQL, [leaderUserId]),
      query(SESSIONS_SQL, [leaderUserId]),
    ]);
    const rows = sessions.rows || [];
    return {
      upcoming: (schedules.rows || []).map((r) => shapeSchedule(r, today)),
      pendingDebriefs: rows.filter(isPendingDebrief).map(shapeSession),
      completed: rows.filter(isCompleted).map(shapeSession),
    };
  } catch (error) {
    // The portal home must render even when this panel can't — degrade, never throw.
    console.error('leader-observations: resolver failed:', error.message);
    return { upcoming: [], pendingDebriefs: [], completed: [] };
  }
}

module.exports = { getLeaderObservations };
