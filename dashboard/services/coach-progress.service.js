/**
 * bd-o15qnr.28.1 (queue #204, v7; #188's canvas LOCK round, "My progress" option B) — the coach's own progress as one
 * read-only page (portal/src/portal/coach/report/CoachProgressPage.tsx), opened from a Home tile:
 *
 *   week          this week's complete observations against 12 (the week the coach is in: a debrief made now counts here)
 *   focus         the Key Focus Area: the week rule's focus for this week, and the debriefs that included it of her last
 *                 10 (all of them if fewer), with the goal at FOCUS_DONE_AT of FOCUS_WINDOW (6 of 10)
 *   behaviours    her 8 behaviours over the last 10 debriefs: seen in n of them (n of the ones the judge scored), most seen
 *                 first, ties in the rubric's (= the modules') order. Exactly the 8: Respect held is the must-pass check
 *                 (isHarmfulDebrief), not one of them, and comes as its own flag `respectAll`
 *   observations  the 3 most recent (the teacher, the day, where it stands by coach-v2's stepOf, and the debrief's
 *                 behaviours seen / judged once there is a debrief; a harmful debrief has none)
 *   weeks         her weekly reports: ready weeks with a debrief, newest first, against 12; null when her week page does
 *                 not open for her (`weeks: false`, the week route's own gate: coach_reports_app)
 *
 * Counts only (the operator, 20 Nov 15:04: "Just the debrief scores like 2/8, 5/8" are a %; the page makes that one %).
 * Every count is code, from the judge's booleans, by the bot's pure coach-week.js and observe-coach-rubric.js, over the
 * same rows the week service reads (coach-week.service SQL.DEBRIEFS). No averages, no stars.
 *
 * WHO. Only the session's coach, by her own observer_user_id; there is no id of anyone else to ask for.
 * READS ONLY. Two bounded SELECTs (narrow JSON slices; analysis_data is never pulled whole). Nothing is written.
 * `query` is injected ((sql, params) => Promise<{rows, rowCount}>), like every coach service.
 */

const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const Week = require('../../bot/shared/services/observe/coach-week');
const Rubric = require('../../bot/shared/services/observe/observe-coach-rubric');
const { isHarmfulDebrief } = require('../../bot/shared/services/observe/observe-coach-feedback');
const CoachWeek = require('./coach-week.service');
const { stepOf } = require('./coach-v2.service');

/** The newest weekly reports listed. */
const WEEKS_SHOWN = 4;
/** The week service's read limit: a read this long may have cut its oldest week short. */
const DEBRIEF_LIMIT = CoachWeek.LATEST;

const SQL = {
  // Her 3 most recent observations (failed and cancelled ones are not visits). The teacher's name as the Observe list
  // finds it: the schedule's, the delivered report's, then the user's (never her own name on a self-observation).
  RECENT: `
    SELECT c.id, c.created_at, c.status, c.debrief_status,
           c.analysis_data->'teacher_delivery'->>'status' AS delivery_status,
           c.analysis_data->'observer_debrief'->'feedback'->'rubric' AS rubric,
           u.name AS teacher_name,
           c.analysis_data->'teacher_delivery'->>'teacher_name' AS delivery_teacher_name,
           os.teacher_name AS sched_teacher_name
    FROM coaching_sessions c
    LEFT JOIN users u ON u.id = c.user_id AND c.user_id IS DISTINCT FROM c.observer_user_id
    LEFT JOIN LATERAL (
      SELECT s.teacher_name FROM observation_schedules s
      WHERE s.session_id = c.id ORDER BY s.updated_at DESC NULLS LAST LIMIT 1
    ) os ON true
    WHERE c.observer_user_id = $1
      AND c.observation_type = 'leader_observation'
      AND c.status NOT IN ('failed', 'cancelled')
    ORDER BY c.created_at DESC
    LIMIT 3
  `,
};

const EN = observeStrings('en');
const UR = observeStrings('ur');
const both = (field, key) => ({ en: (EN[field] || {})[key] || null, ur: (UR[field] || {})[key] || null });
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const iso = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const byTimeDesc = (a, b) => Date.parse(b.at) - Date.parse(a.at);

/** Her coached debriefs (the week service's rows), placed in weeks by the week rule; `full` = the read hit its limit. */
async function readDebriefs(query, coachId, untilIso) {
  const { rows } = await query(CoachWeek.SQL.DEBRIEFS, [coachId, untilIso]);
  const list = rows || [];
  const debriefs = list
    .map((r) => ({ id: r.id, at: iso(r.feedback_at) || iso(r.created_at), rubric: r.rubric }))
    .filter((d) => d.at && d.rubric && typeof d.rubric === 'object')
    .map((d) => ({ ...d, week: Week.weekOfDebrief(d.at) }));
  return { debriefs, full: list.length >= DEBRIEF_LIMIT };
}

/** n of the debriefs the judge scored on `key` (coach-week.js's own count). */
function countOf(list, key) {
  const of = list.filter((d) => typeof d.rubric[key] === 'boolean');
  return { done: of.filter((d) => d.rubric[key] === true).length, of: of.length };
}

function behavioursOf(last) {
  const order = Rubric.BEHAVIOUR_KEYS;
  return order
    .map((key) => ({ key, name: both('coach_rubric_names', key), ...countOf(last, key) }))
    .filter((b) => b.of > 0)
    .sort((a, b) => (b.done * a.of - a.done * b.of) || (order.indexOf(a.key) - order.indexOf(b.key)));
}

function weeksOf(debriefs, full, now) {
  const ready = Week.latestReadyMonday(now);
  const oldest = debriefs.length ? debriefs.reduce((m, d) => (d.week < m ? d.week : m), debriefs[0].week) : null;
  const counts = new Map();
  for (const d of debriefs) {
    if (d.week > ready) continue;
    if (full && d.week <= oldest) continue; // a full read may have cut this week short: leave it out, never undercount
    counts.set(d.week, (counts.get(d.week) || 0) + 1);
  }
  return [...counts.keys()].sort().reverse().slice(0, WEEKS_SHOWN).map((monday) => ({
    monday, friday: Week.weekBounds(monday).friday, complete: counts.get(monday), target: Week.TARGET,
  }));
}

function observationOf(r) {
  const harmful = !!(r.rubric && typeof r.rubric === 'object' && isHarmfulDebrief(r.rubric));
  const m = r.rubric && typeof r.rubric === 'object' && !harmful ? Rubric.rubricMarks(r.rubric) : null;
  return {
    id: r.id,
    at: iso(r.created_at),
    teacher: text(r.sched_teacher_name) || text(r.delivery_teacher_name) || text(r.teacher_name),
    step: stepOf({ status: r.status, debrief_status: r.debrief_status, delivery: { status: r.delivery_status || null } }),
    debrief: m && m.total > 0 ? { done: m.done, total: m.total } : null,
  };
}

/**
 * Her progress, or null with no coach.
 * @param {(sql: string, params: unknown[]) => Promise<{rows: object[]}>} query
 * @param {string} coachId the session user, always
 * @param {{ weeks?: boolean, now?: Date }} opts weeks: her week page opens (coach_reports_app)
 */
async function getCoachProgress(query, coachId, opts = {}) {
  if (!coachId) return null;
  const now = opts.now || new Date();
  const [{ debriefs, full }, recent] = await Promise.all([
    readDebriefs(query, coachId, now.toISOString()),
    query(SQL.RECENT, [coachId]),
  ]);

  const monday = Week.weekOfDebrief(now.toISOString());
  const bounds = Week.weekBounds(monday);
  const thisWeek = debriefs.filter((d) => d.week === monday);
  const summary = Week.summariseWeek({
    monday,
    thisWeek,
    lastWeek: debriefs.filter((d) => d.week === Week.addDays(monday, -7)),
    before: debriefs.filter((d) => d.week < monday),
  });
  const last = [...debriefs].sort(byTimeDesc).slice(0, Week.FOCUS_WINDOW);
  const f = summary.focus;

  return {
    week: { monday, friday: bounds.friday, complete: thisWeek.length, target: Week.TARGET },
    focus: f ? {
      key: f.key,
      name: both('coach_rubric_names', f.key),
      last10: f.last10,
      doneAt: Week.FOCUS_DONE_AT,
      window: Week.FOCUS_WINDOW,
    } : null,
    behaviours: behavioursOf(last),
    window: last.length,
    respectAll: last.length > 0 && last.every((d) => d.rubric.disparaged_teacher === false),
    observations: ((recent && recent.rows) || []).map(observationOf),
    weeks: opts.weeks ? weeksOf(debriefs, full, now) : null,
  };
}

module.exports = { SQL, WEEKS_SHOWN, DEBRIEF_LIMIT, getCoachProgress };
