/**
 * The coach's debrief report as a page in the coach app (behind app_settings.coach_reports_app).
 *
 * Today the coach gets her debrief feedback as a picture on WhatsApp. This is the same report as a page: the
 * page (portal/src/portal/coach/report/), the Home card that announces it, and the "opened" / "seen" facts the
 * WhatsApp fallback reads (bot/shared/services/observe/coach-report-whatsapp.service.js).
 *
 * WHAT IT SAYS, AND ONCE (the ICT HITL owner's design and her 5 Nov review):
 *   header      the teacher, the class and lesson, when the report was ready
 *   marks       the eight behaviours in the rubric's order, done or missed, COMPUTED from the judge's booleans by the
 *               bot's own observe-coach-rubric (never from model text); Respect on its own line
 *   did         every done behaviour, each with what the coach did (the judge's `did` line; none = no line)
 *   missed      every missed behaviour: what happened in THIS debrief, why it matters, its Coach Training module
 *   focus       one next focus: the move, why this one, its module, and its ready "Try:" line (none supplied = null:
 *               the page marks the gap, nothing is invented)
 *   NOT SENT    the reflection question (removed) and the praise banner (it repeated "What you did well").
 *   harmful     a debrief where the coach disparaged the teacher: the concern only, no marks to celebrate.
 *
 * Fixed words (behaviour names, why-it-matters) come in English AND Urdu from the bot's observe-strings, so the
 * page switches language without a second read. The judge's own lines are in the language they were written in.
 *
 * WHO. Only the report's own coach (coaching_sessions.observer_user_id = the session user) reads it or marks it;
 * anyone else is `forbidden` (403). The id is checked before any query.
 *
 * READS. analysis_data is never pulled whole (Class R): only ->observer_debrief->feedback and the few header keys.
 * The coach_report_* columns (bot/database/migrations/coach_report_notice.sql) are read and written only here, only for a coach with the switch on.
 *
 * `query` is injected ((sql, params) => Promise<{rows, rowCount}>), like every coach service.
 */

const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const Rubric = require('../../bot/shared/services/observe/observe-coach-rubric');
const { isHarmfulDebrief } = require('../../bot/shared/services/observe/observe-coach-feedback');
const { BEHAVIOUR_MODULE } = require('../../bot/shared/config/coach-training-modules');

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How long a ready report waits on the Home card if she neither opens nor closes it. */
const READY_WINDOW_DAYS = 3;
const READY_LIMIT = 3;

const TEACHER_SQL = `
    u.name AS teacher_name,
    c.analysis_data->'teacher_delivery'->>'teacher_name' AS delivery_teacher_name,
    os.teacher_name AS sched_teacher_name`;
const TEACHER_JOINS = `
    LEFT JOIN users u ON u.id = c.user_id AND c.user_id IS DISTINCT FROM c.observer_user_id
    LEFT JOIN LATERAL (
      SELECT s.teacher_name FROM observation_schedules s
      WHERE s.session_id = c.id ORDER BY s.updated_at DESC NULLS LAST LIMIT 1
    ) os ON true`;

const SQL = {
  REPORT: `
    SELECT c.id, c.observer_user_id, c.user_id, c.created_at, c.status, c.debrief_status,
           c.analysis_data->'observer_debrief'->'feedback' AS feedback,
           c.analysis_data->'observer_debrief'->>'completed_at' AS feedback_at,
           c.analysis_data->>'topic' AS topic,
           c.analysis_data->>'subject' AS subject,
           c.analysis_data->>'grade' AS grade,${TEACHER_SQL}
    FROM coaching_sessions c${TEACHER_JOINS}
    WHERE c.id = $1 AND c.observation_type = 'leader_observation'
  `,

  // Her coached debriefs she has neither opened nor closed, newest first: what the Home card shows. Served by the
  // coach_report_notice.sql partial index (rows still waiting on the coach, by created_at).
  READY: `
    SELECT c.id, c.created_at,
           c.analysis_data->'observer_debrief'->>'completed_at' AS feedback_at,
           c.analysis_data->>'subject' AS subject,
           c.analysis_data->>'grade' AS grade,${TEACHER_SQL}
    FROM coaching_sessions c${TEACHER_JOINS}
    WHERE c.observer_user_id = $1
      AND c.observation_type = 'leader_observation'
      AND c.debrief_status = 'done'
      AND c.coach_report_opened_at IS NULL
      AND c.coach_report_seen_at IS NULL
      AND c.created_at >= now() - interval '${READY_WINDOW_DAYS} days'
      AND c.analysis_data->'observer_debrief' ? 'feedback'
    ORDER BY c.created_at DESC
    LIMIT ${READY_LIMIT}
  `,

  OPENED: `
    UPDATE coaching_sessions SET coach_report_opened_at = now()
    WHERE id = $1 AND observer_user_id = $2 AND coach_report_opened_at IS NULL
    RETURNING id
  `,

  SEEN: `
    UPDATE coaching_sessions SET coach_report_seen_at = now()
    WHERE id = $1 AND observer_user_id = $2 AND coach_report_seen_at IS NULL
    RETURNING id
  `,
};

const EN = observeStrings('en');
const UR = observeStrings('ur');
const both = (field, key) => ({ en: (EN[field] || {})[key] || null, ur: (UR[field] || {})[key] || null });
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The ready "Try:" line for a behaviour in both languages (observe-strings coach_report_try_lines), or null until BOTH exist. */
function tryLineFor(key) {
  const t = both('coach_report_try_lines', key);
  return t.en && t.ur ? t : null;
}

function teacherOf(row) {
  return text(row.teacher_name) || text(row.delivery_teacher_name) || text(row.sched_teacher_name);
}

/**
 * The report as the page shows it. Pure.
 * @param {object} row a SQL.REPORT row
 */
function shapeCoachReport(row) {
  const fb = row.feedback || {};
  const harmful = !!(fb.rubric && isHarmfulDebrief(fb.rubric));
  const header = {
    teacher: teacherOf(row),
    grade: text(row.grade),
    subject: text(row.subject),
    topic: text(row.topic),
    at: row.feedback_at || row.created_at || null,
  };
  if (harmful) {
    const c = fb.concern || {};
    return {
      id: row.id, header, harmful: true,
      concern: { what_happened: text(c.what_happened), why_it_matters: text(c.why_it_matters), instead: text(c.instead) },
      marks: [], done: 0, total: 0, respectHeld: false, did: [], missed: [], focus: null,
    };
  }

  const m = Rubric.rubricMarks(fb.rubric);
  const did = fb.did && typeof fb.did === 'object' ? fb.did : {};
  const said = fb.missed && typeof fb.missed === 'object' ? fb.missed : {};
  const focusKey = Rubric.nextFocusKey(fb);
  const t = fb.try || {};

  return {
    id: row.id,
    header,
    harmful: false,
    concern: null,
    marks: m.marks.map((x) => ({ key: x.key, done: x.done, name: both('coach_rubric_names', x.key) })),
    done: m.done,
    total: m.total,
    respectHeld: m.respectHeld,
    did: m.marks.filter((x) => x.done).map((x) => ({ key: x.key, name: both('coach_rubric_names', x.key), line: text(did[x.key]) })),
    missed: m.marks.filter((x) => !x.done).map((x) => ({
      key: x.key,
      name: both('coach_rubric_names', x.key),
      line: text(said[x.key]),
      why: both('coach_rubric_why', x.key),
      module: BEHAVIOUR_MODULE[x.key] || null,
    })),
    focus: focusKey ? {
      key: focusKey,
      move: text(t.move),
      why: text(fb.focus_why),
      module: BEHAVIOUR_MODULE[focusKey] || null,
      tryLine: tryLineFor(focusKey),
    } : null,
  };
}

/**
 * Her report, or why not.
 * @returns {Promise<{status:'ok', report:object}|{status:'forbidden'|'not_found'|'not_ready'}>}
 */
async function getCoachReport(query, coachId, id) {
  if (!coachId || !UUID_RX.test(String(id || ''))) return { status: 'not_found' };
  const { rows } = await query(SQL.REPORT, [id]);
  const row = rows && rows[0];
  if (!row) return { status: 'not_found' };
  if (String(row.observer_user_id) !== String(coachId)) return { status: 'forbidden' };
  if (!row.feedback) return { status: 'not_ready' };
  return { status: 'ok', report: shapeCoachReport(row) };
}

/** Stamp opened (any door) or seen (✕ on the Home card), once, on her own row. True when this call stamped it. */
async function markCoachReport(query, coachId, id, what) {
  const sql = what === 'opened' ? SQL.OPENED : what === 'seen' ? SQL.SEEN : null;
  if (!sql) throw new Error(`coach report: unknown mark ${what}`);
  if (!coachId || !UUID_RX.test(String(id || ''))) return false;
  const { rowCount } = await query(sql, [id, coachId]);
  return rowCount > 0;
}

/** What the Home card shows: her ready debrief reports, newest first. */
async function readyCoachReports(query, coachId) {
  if (!coachId) return [];
  const { rows } = await query(SQL.READY, [coachId]);
  return (rows || []).map((r) => ({
    kind: 'debrief',
    id: r.id,
    at: r.feedback_at || r.created_at || null,
    teacher: teacherOf(r),
    subject: text(r.subject),
    grade: text(r.grade),
  }));
}

module.exports = {
  SQL, UUID_RX, READY_WINDOW_DAYS, tryLineFor, shapeCoachReport, getCoachReport, markCoachReport, readyCoachReports,
};
