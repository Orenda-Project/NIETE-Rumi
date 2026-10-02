'use strict';
/**
 * When a coach's observation of a teacher becomes the TEACHER's to see.
 *
 * The row is hers (user_id = the teacher, observation_type 'leader_observation',
 * observer_user_id = the coach), so any route that reads her coaching_sessions
 * reaches it from the moment the coach records — while it is still a draft the
 * coach is reviewing, a debrief in progress, a report she has not sent. It is
 * hers only once the coach has SENT it: analysis_data.teacher_delivery.status
 * = 'sent', which processTeacherReport writes when the report reaches her
 * WhatsApp (directly, or when she taps the invite). 'awaiting_teacher_tap' is
 * not delivered yet; 'operator_review' went to a review number, not to her.
 *
 * Measured read-only on NIETE production, 2026-10-02: of the completed bound
 * observations, 2,759 are 'sent' and 2 are not (both 'cancelled') — so this
 * rule keeps every report a teacher actually received.
 */

const OBSERVATION_TYPE = 'leader_observation';
const DELIVERED = 'sent';

/** PostgREST or=(): her own sessions, plus observations the coach sent her. */
const VISIBLE_TO_TEACHER_OR = [
  'observation_type.is.null',
  `observation_type.neq.${OBSERVATION_TYPE}`,
  `analysis_data->teacher_delivery->>status.eq.${DELIVERED}`,
].join(',');

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
  return status === DELIVERED;
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
  VISIBLE_TO_TEACHER_OR,
  NOT_AN_OBSERVATION_OR,
  isObservation,
  teacherMaySee,
  observerNames,
};
