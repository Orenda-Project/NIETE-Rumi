'use strict';
/**
 * When a coach's observation of a teacher becomes the TEACHER's to see.
 *
 * The row is hers (user_id = the teacher, observation_type 'leader_observation',
 * observer_user_id = the coach), so any route that reads her coaching_sessions
 * reaches it from the moment the coach records — while it is still a draft the
 * coach is reviewing, a debrief in progress, a report she has not sent. It is
 * hers once the coach has SENT it (analysis_data.teacher_delivery.status):
 *   'sent'                  it reached her WhatsApp (processTeacherReport)
 *   'awaiting_teacher_tap'  WhatsApp's 24-hour window was closed, so she was
 *                           sent an invite; the report is made and stored, and
 *                           goes to WhatsApp when she taps. Operator, bd-5rz1v.6.8:
 *                           she sees it in the portal whether or not she taps.
 * Never: no delivery yet or 'awaiting_confirm' (the coach's preview),
 * 'operator_review' (it went to a review number, not to her), 'cancelled'.
 *
 * Measured read-only on NIETE production, 2026-10-02: of the completed bound
 * observations, 2,759 are 'sent' and 2 are not (both 'cancelled') — so this
 * rule keeps every report a teacher actually received.
 */

const OBSERVATION_TYPE = 'leader_observation';
const DELIVERED = 'sent';
/** The delivery states in which the coach has sent it to her. */
const SENT_TO_TEACHER = Object.freeze([DELIVERED, 'awaiting_teacher_tap']);

const sentTerms = SENT_TO_TEACHER.map((s) => `analysis_data->teacher_delivery->>status.eq.${s}`);

/** PostgREST or=(): her own sessions, plus observations the coach sent her. */
const VISIBLE_TO_TEACHER_OR = [
  'observation_type.is.null',
  `observation_type.neq.${OBSERVATION_TYPE}`,
  ...sentTerms,
].join(',');

/**
 * Her Coaching LIST: her own lessons once completed, and every observation the
 * coach sent her — whatever its status, since an observation only becomes
 * 'completed' once the coach's debrief is done too (observe-completion), which
 * can come after the report.
 */
const LISTED_FOR_TEACHER_OR = [
  'and(observation_type.is.null,status.eq.completed)',
  `and(observation_type.neq.${OBSERVATION_TYPE},status.eq.completed)`,
  ...sentTerms,
].join(',');

/**
 * The same rule as SQL, for the routes that read coaching_sessions through the
 * pool (unaliased columns): her own sessions, plus observations sent to her.
 */
const VISIBLE_TO_TEACHER_SQL = `(observation_type IS NULL OR observation_type <> '${OBSERVATION_TYPE}' `
  + `OR analysis_data->'teacher_delivery'->>'status' IN (${SENT_TO_TEACHER.map((s) => `'${s}'`).join(', ')}))`;

/**
 * LISTED_FOR_TEACHER_OR as SQL, for the pool (bd-5rz1v.17 — the Home's coaching count and its
 * list): her own lessons once completed, and every observation the coach sent her, whatever its
 * status. Term for term the same three arms, built from the same constants, so the Home's number
 * and her Coaching list cannot drift apart. `alias` qualifies the columns (e.g. 'c').
 */
function listedForTeacherSql(alias) {
  const col = (name) => (alias ? `${alias}.${name}` : name);
  const sent = SENT_TO_TEACHER.map((s) => `'${s}'`).join(', ');
  return `((${col('observation_type')} IS NULL AND ${col('status')} = 'completed')`
    + ` OR (${col('observation_type')} <> '${OBSERVATION_TYPE}' AND ${col('status')} = 'completed')`
    + ` OR ${col('analysis_data')}->'teacher_delivery'->>'status' IN (${sent}))`;
}

/** PostgREST or=(): her own sessions only — what is in flight is never a coach's. */
const NOT_AN_OBSERVATION_OR = ['observation_type.is.null', `observation_type.neq.${OBSERVATION_TYPE}`].join(',');

function isObservation(row) {
  return !!row && row.observation_type === OBSERVATION_TYPE;
}

/**
 * @param {object} row  a coaching_sessions row (or a slice of one)
 * @param {string|null} [deliveryStatus]  when the row carries only a slice of analysis_data
 */
function teacherMaySee(row, deliveryStatus) {
  if (!isObservation(row)) return true;
  const status = deliveryStatus !== undefined
    ? deliveryStatus
    : (((row.analysis_data || {}).teacher_delivery) || {}).status;
  return SENT_TO_TEACHER.includes(status);
}

/** The coaches' names, for "Observed by …". One read for a whole page of rows. */
async function observerNames(supabase, rows) {
  const ids = [...new Set((rows || []).filter(isObservation).map((r) => r.observer_user_id).filter(Boolean))];
  if (!ids.length) return {};
  try {
    const { data } = await supabase.from('users').select('id, name').in('id', ids);
    return Object.fromEntries((data || []).map((u) => [u.id, (u.name || '').trim() || null]));
  } catch (_) {
    return {};
  }
}

module.exports = {
  OBSERVATION_TYPE,
  DELIVERED,
  SENT_TO_TEACHER,
  VISIBLE_TO_TEACHER_OR,
  LISTED_FOR_TEACHER_OR,
  VISIBLE_TO_TEACHER_SQL,
  listedForTeacherSql,
  NOT_AN_OBSERVATION_OR,
  isObservation,
  teacherMaySee,
  observerNames,
};
