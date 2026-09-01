/**
 * bd-j3j4b — auto-advance a coaching session stranded at the photo / lesson-plan
 * gate. The photo/LP is optional and the FICO report is derivable from the audio,
 * yet NIETE (unlike the main bot) had no in-process photo timeout AND its stale
 * sweeper only covered `conducting_conversation` — so a session that reached
 * awaiting_photo / awaiting_classroom_photo / awaiting_lesson_plan and never got a
 * well-formed photo froze forever (0 report). This module is the worker backstop.
 *
 * Pure + supabase-free so it is unit-testable; the worker supplies the DB glue.
 */

const PHOTO_GATE_STATUSES = ['awaiting_photo', 'awaiting_classroom_photo', 'awaiting_lesson_plan'];

/**
 * @param {object|null} session  coaching_sessions row (status, created_at/updated_at, transcript_text)
 * @param {number} nowMs         current time (injected for testability)
 * @param {number} thresholdMs   how long stuck before we auto-advance
 * @returns {boolean} true = auto-advance this session (queue analysis, report-only)
 */
function shouldAutoAdvancePhotoGate(session, nowMs = Date.now(), thresholdMs = 60 * 60 * 1000) {
  if (!session || !PHOTO_GATE_STATUSES.includes(session.status)) return false;
  // No transcript = no class audio to score → nothing to report; leave it alone.
  if (!session.transcript_text) return false;
  const stamp = Date.parse(session.created_at || session.updated_at || '');
  if (Number.isNaN(stamp)) return false;
  return nowMs - stamp >= thresholdMs;
}

/**
 * bd-5knlj — the sweep threshold is PER SESSION TYPE. 60 minutes suits teacher
 * self-record (fast report beats frozen session); on a leader observation the
 * coach is mid-school-visit and answers the LP prompt hours later — sweeping
 * at 60 minutes deleted her Section B (96 of 379 broken observations,
 * Aug 24 – Sep 1). Observations default to 8 hours; both are env-tunable.
 */
const MINUTE = 60 * 1000;
function gateThresholdFor(session, env = process.env) {
  const isObservation = !!(session && session.observation_type === 'leader_observation');
  if (isObservation) {
    const m = Number(env.OBSERVE_LP_GATE_MINUTES);
    return (Number.isFinite(m) && m > 0 ? m : 8 * 60) * MINUTE;
  }
  const m = Number(env.COACHING_PHOTO_GATE_MINUTES);
  return (Number.isFinite(m) && m > 0 ? m : 60) * MINUTE;
}

module.exports = { PHOTO_GATE_STATUSES, shouldAutoAdvancePhotoGate, gateThresholdFor };
