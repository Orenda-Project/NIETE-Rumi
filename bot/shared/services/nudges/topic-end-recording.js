'use strict';
/**
 * THE TOPIC-END NUDGE, RECORDING TRIGGER (bd-pw1ccr.11) — she recorded herself teaching the end of a topic.
 *
 * Called by analysis-processor once a coaching session's analysis is written, so it covers a WhatsApp recording and
 * a portal recording alike. Only her own recording counts: a leader observation is someone else's visit.
 *
 * WHICH LESSON. The plan linked to the session (lesson_plan_structured._fidelity_ref.lesson_id, set by the LP
 * linker or the portal plan library). With none linked, her latest K-5 plan taken in the 24 hours before the
 * recording: a WhatsApp delivery that reached her (niete_lp_downloads, status 'sent') or a read in the app
 * (niete_lp_opens, plan_kind 'k5'). From there it is the plan-pull nudge exactly (topic-end-nudge.service
 * onLessonDelivered), with trigger 'recording' and the recording time standing in for the time she took the plan.
 *
 * One nudge a teacher a topic holds across both triggers: the UNIQUE (user_id, nudge_date, kind) row, and the
 * already_nudged_topic check at send. Never throws.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Arm = require('./topic-end-arm');

const LOOKBACK_MS = 24 * 60 * 60 * 1000;

const no = (reason) => ({ scheduled: false, reason });

function linkedLesson(session) {
  const lp = session && session.lesson_plan_structured;
  const ref = lp && typeof lp === 'object' ? lp._fidelity_ref : null;
  return ref && typeof ref.lesson_id === 'string' && ref.lesson_id ? ref.lesson_id : null;
}

/** Her latest K-5 plan in the 24 hours up to the recording, from either channel. Throws on a read error. */
async function latestPlan(userId, recordedAt) {
  const until = recordedAt.toISOString();
  const since = new Date(recordedAt.getTime() - LOOKBACK_MS).toISOString();
  const [dl, op] = await Promise.all([
    supabase.from('niete_lp_downloads').select('lesson_id, created_at')
      .eq('user_id', userId).eq('status', 'sent').gte('created_at', since).lte('created_at', until)
      .order('created_at', { ascending: false }).limit(1),
    supabase.from('niete_lp_opens').select('plan_ref, opened_at')
      .eq('user_id', userId).eq('plan_kind', 'k5').gte('opened_at', since).lte('opened_at', until)
      .order('opened_at', { ascending: false }).limit(1),
  ]);
  if (dl.error) throw new Error(`downloads: ${dl.error.message}`);
  if (op.error) throw new Error(`opens: ${op.error.message}`);
  const d = (dl.data || [])[0];
  const o = (op.data || [])[0];
  if (d && o) return Date.parse(o.opened_at) > Date.parse(d.created_at) ? o.plan_ref : d.lesson_id;
  return (d && d.lesson_id) || (o && o.plan_ref) || null;
}

/**
 * @param {{session: {id, user_id, observation_type, created_at, lesson_plan_structured}}} p
 * @returns {Promise<{scheduled: boolean, reason?: string}>}
 */
async function onRecording({ session } = {}) {
  if (!session || !session.user_id || session.observation_type === 'leader_observation') return no('not_self_recording');
  try {
    if (!(await Arm.enabled())) return no('disabled');
    const recordedAt = session.created_at ? new Date(session.created_at) : new Date();
    const lessonId = linkedLesson(session) || (await latestPlan(session.user_id, recordedAt));
    if (!lessonId) return no('no_plan');
    return await require('./topic-end-nudge.service').onLessonDelivered({
      userId: session.user_id, lessonId, deliveredAt: recordedAt.toISOString(), trigger: 'recording',
    });
  } catch (err) {
    logToFile('❌ topic nudge: recording could not be decided — not booked', { sessionId: session.id, error: err && err.message }, 'error');
    return no('guard_unavailable');
  }
}

module.exports = { onRecording, LOOKBACK_MS };
