'use strict';
/**
 * bd-5rz1v.6 — where a portal-started observation stands, as the coach's portal
 * shows it. One step at a time, in the order WhatsApp /observe walks a coach
 * through it:
 *
 *   analysing        the lesson is being transcribed and analysed
 *   draft            the draft report is ready to check (awaiting_observer_review)
 *   talk             the draft is saved; record the talk with the teacher
 *                    (problem: too_short | failed | feedback_failed | duplicate)
 *   listening        the talk is being transcribed and coached
 *   feedback         her own feedback is ready; the report has not been started
 *   report           the report preview is being made (preparing) or is ready
 *                    (problem: send_failed)
 *   sending          she pressed Send; the deliver job is running
 *   waiting_teacher  the teacher was sent the invite and has not tapped it yet
 *   sent             the report reached the teacher (or the operator's review)
 *   done             completed — debrief done and report sent
 *   stopped          cancelled, abandoned or failed (problem: duplicate)
 *
 * Read from the row alone, so the page and the worker can never disagree. Pure,
 * with no requires.
 */

/**
 * The talk with the teacher, from analysis_data.observer_debrief. A WhatsApp
 * voice note carries `audio_id`; a portal upload carries `audio_r2_key` and no
 * audio id — so a voice note sent after a portal recording is the WhatsApp one.
 * @param {object|null} od
 */
function talkOf(od) {
  const o = od || {};
  return {
    recorded: !!(o.audio_id || o.audio_r2_key),
    portal: !o.audio_id && !!o.audio_r2_key,
    tooShort: !!o.too_short_at,
    failed: !!o.failed_at,
    feedbackFailed: !!o.feedback_failed_at,
    duplicate: !!o.duplicate_refused_at,
    feedback: !!o.feedback,
  };
}

const STOPPED = new Set(['cancelled', 'abandoned', 'failed']);

/**
 * @param {{status: string, debriefStatus?: string, deliveryStatus?: string|null,
 *          sendRequested?: boolean, talk?: object, duplicate?: boolean}} s
 * @returns {{step: string, problem?: string|null, preparing?: boolean}}
 */
function observeStep(s) {
  const { status, debriefStatus, deliveryStatus, sendRequested } = s || {};
  if (status === 'completed') return { step: 'done', problem: null };
  if (STOPPED.has(status)) return { step: 'stopped', problem: s.duplicate ? 'duplicate' : null };
  if (status === 'awaiting_observer_review') return { step: 'draft', problem: null };
  if (status !== 'observer_review_complete') return { step: 'analysing', problem: null };

  if (debriefStatus !== 'done') {
    const t = s.talk || talkOf(null);
    // Feedback written and the done-flip still to land: the worker is finishing.
    if (t.feedback) return { step: 'listening', problem: null };
    if (!t.recorded) return { step: 'talk', problem: t.duplicate ? 'duplicate' : null };
    if (t.tooShort) return { step: 'talk', problem: 'too_short' };
    if (t.failed) return { step: 'talk', problem: 'failed' };
    if (t.feedbackFailed) return { step: 'talk', problem: 'feedback_failed' };
    return { step: 'listening', problem: null };
  }

  switch (deliveryStatus) {
    case 'sent':
    case 'operator_review':
      return { step: 'sent', problem: null };
    case 'awaiting_teacher_tap':
      return { step: 'waiting_teacher', problem: null };
    case 'send_failed':
      return { step: 'report', problem: 'send_failed', preparing: false };
    case 'awaiting_confirm':
      return sendRequested ? { step: 'sending', problem: null } : { step: 'report', problem: null, preparing: false };
    case 'previewing':
      return { step: 'report', problem: null, preparing: true };
    default:
      // No report started — or a cancelled one, which is the same to her.
      return { step: 'feedback', problem: null };
  }
}

/** The step of a full coaching_sessions row (analysis_data read whole). */
function stepOfRow(row) {
  const r = row || {};
  const ad = r.analysis_data || {};
  const td = ad.teacher_delivery || {};
  return observeStep({
    status: r.status,
    debriefStatus: r.debrief_status,
    deliveryStatus: td.status || null,
    sendRequested: !!td.send_requested_at,
    talk: talkOf(ad.observer_debrief),
    duplicate: !!r.duplicate_of_session_id,
  });
}

module.exports = { observeStep, talkOf, stepOfRow };
