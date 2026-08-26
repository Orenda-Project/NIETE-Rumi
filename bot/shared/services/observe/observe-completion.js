'use strict';
/**
 * bd-9rrd5 — HITL observations never reached status='completed'; the flow's
 * terminal state was observer_review_complete, so every surface counting
 * "completed" (observability dashboard, portal teacher-performance bd-2671,
 * M&E tallies) showed a pure-HITL coach at ZERO. Live proof: Meerab, 12
 * observations since 20-Aug, all debriefs done, count shown: 0.
 *
 * An observation is DONE when all three hold:
 *   status = observer_review_complete  (form submitted)
 *   debrief_status = done              (debrief coached)
 *   teacher_delivery.status = sent     (report reached the teacher)
 * Both completion orders fire this (sent-then-debrief, debrief-then-sent):
 * the callers are the sent-merge (observe-send) and the done-flip
 * (observe-debrief), each calling maybeCompleteObservation afterwards.
 *
 * The write is CAS-guarded on status=observer_review_complete so a concurrent
 * transition (cancel, another worker) is never clobbered. Consumers audited
 * 26-Aug: pending-debriefs list filters debrief='pending' (unaffected),
 * Send-reports list filters delivery unsent (unaffected), portal isCompleted
 * already includes 'completed'.
 *
 * Load (Class R): one projected single-row read + one keyed CAS update, fired
 * at most twice per observation lifetime.
 */

const { logToFile } = require('../../utils/logger');

/**
 * @param {{ status?: string, debrief_status?: string,
 *           teacher_delivery?: { status?: string } | null }} session
 * @returns {boolean}
 */
function shouldComplete(session) {
  if (!session) return false;
  if (session.status !== 'observer_review_complete') return false;
  if (session.debrief_status !== 'done') return false;
  const d = session.teacher_delivery;
  return !!(d && d.status === 'sent');
}

/**
 * Flip the session to 'completed' when the three conditions hold. Never throws
 * — completion is bookkeeping and must not fail the calling flow.
 * @param {string} sessionId
 * @returns {Promise<boolean>} true when the flip happened
 */
async function maybeCompleteObservation(sessionId) {
  try {
    const supabase = require('../../config/supabase');
    const { data: session } = await supabase
      .from('coaching_sessions')
      .select('id, status, debrief_status, teacher_delivery:analysis_data->teacher_delivery')
      .eq('id', sessionId)
      .maybeSingle();
    if (!shouldComplete(session)) return false;
    await supabase
      .from('coaching_sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId)
      .eq('status', 'observer_review_complete');
    logToFile('🏁 observation completed (debrief done + report sent)', { sessionId });
    return true;
  } catch (err) {
    logToFile('⚠️ observe completion check failed (non-fatal)', {
      sessionId, error: err && err.message,
    });
    return false;
  }
}

module.exports = { shouldComplete, maybeCompleteObservation };
