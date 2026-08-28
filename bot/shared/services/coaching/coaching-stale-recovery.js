/**
 * bd-2417 (FEAT-106 row 13) — recovery for coaching sessions stuck at the
 * confirmation gate.
 *
 * A long classroom recording sets status='initiated' / AWAITING_CONFIRMATION and
 * sends a "Yes, Analyze" button. If the teacher never taps it (Sidra sent a
 * 16-min recording and waited 2h), the session froze forever — NIETE has no cron
 * to sweep it, and follow-ups got misleading "still analyzing" replies.
 *
 * This pure planner decides the action; the worker executes it (queue
 * transcription to proceed, or mark abandoned). Kept dependency-free so it is
 * unit-testable in isolation.
 */

// Grace window before we act — the teacher may still tap "Yes, Analyze".
const STUCK_INITIATED_MIN_AGE_MS = 30 * 60 * 1000; // 30 minutes
// WhatsApp retains uploaded media ~30 days; past this the media id is dead, so
// we can't transcribe — mark abandoned instead of failing at download.
const STUCK_INITIATED_MAX_AGE_MS = 25 * 24 * 60 * 60 * 1000; // 25 days

/**
 * @param {{status:string, created_at:string, audio_id?:string}} session
 * @param {number} nowMs
 * @returns {{action:'skip'|'auto_confirm'|'abandon', reason?:string}}
 */
function classifyStuckInitiatedSession(session, nowMs = Date.now()) {
  const created = Date.parse((session && session.created_at) || '');
  if (Number.isNaN(created)) return { action: 'skip', reason: 'unparseable_timestamp' };

  const age = nowMs - created;
  if (age < STUCK_INITIATED_MIN_AGE_MS) return { action: 'skip', reason: 'within_grace_window' };
  if (age > STUCK_INITIATED_MAX_AGE_MS) return { action: 'abandon', reason: 'media_expired' };

  // Past the grace window, media still valid: proceed with her recording so she
  // still gets her report (she clearly intended coaching — it's a 15+ min
  // classroom recording). No audio id → nothing to analyse → abandon.
  if (session.audio_id) return { action: 'auto_confirm', reason: 'proceed_with_recording' };
  return { action: 'abandon', reason: 'no_audio' };
}

// ── bd-h9gnk — mid-flight watchdog ─────────────────────────────────────────
// Farzana (589ddfb3) sat at analysis_started for 4+ hours after a deploy-kill:
// nothing watched the processing states between transcription and report.
// Untouched for >45 min → ONE retry from the phase it died in; a spent retry
// fails LOUDLY so the teacher is told instead of waiting forever.

// updated_at is the activity marker: a healthy pipeline touches the row at
// every phase change, so "stale" means no touch for this long.
const MIDFLIGHT_STUCK_AGE_MS = 45 * 60 * 1000; // 45 minutes

// The processing statuses NO other sweep owns. 'initiated' → bd-2417,
// awaiting_* → bd-j3j4b photo gate, conducting_conversation → the 12h
// auto-complete. Observations are IN this set as of bd-go4tl — see above.
const WATCHDOG_STATUSES = new Set([
  'transcribing',
  'transcription_complete',
  'analyzing',
  'analysis_started',
  'analysis_complete',
  'generating_report',
]);

// Which queue re-enters the pipeline at each death phase.
const RETRY_QUEUE_BY_STATUS = {
  transcribing: 'transcription',
  transcription_complete: 'analysis',
  analyzing: 'analysis',
  analysis_started: 'analysis',
  analysis_complete: 'report',
  generating_report: 'report',
};

/**
 * @param {object} session coaching_sessions row (status, updated_at/created_at,
 *   audio_id, analysis_data, observation_type)
 * @param {number} nowMs
 * @returns {{action:'skip'|'retry'|'fail', queue?:string, reason:string}}
 */
function classifyStuckMidFlightSession(session, nowMs = Date.now()) {
  if (!session || !WATCHDOG_STATUSES.has(String(session.status || ''))) {
    return { action: 'skip', reason: 'not_a_watchdog_status' };
  }
  // bd-go4tl: observations used to be skipped here, deferring to "bd-tju8f's
  // sweep". That sweep never existed — bd-tju8f is the coach-INITIATED resume
  // service, so an observation that died mid-pipeline had nothing watching it at
  // all (Javeria's 28-Aug row sat at 'transcribing' for hours). They are
  // classified exactly like teacher sessions now; the WORKER owns the identity
  // difference — every message and callback goes to the COACH, not the observed
  // teacher, who never started this and must never hear about it.
  const stamp = Date.parse(session.updated_at || session.created_at || '');
  if (Number.isNaN(stamp)) return { action: 'skip', reason: 'unparseable_timestamp' };
  if (nowMs - stamp < MIDFLIGHT_STUCK_AGE_MS) return { action: 'skip', reason: 'still_fresh' };

  const spent = session.analysis_data && session.analysis_data.watchdog
    && session.analysis_data.watchdog.retried_at;
  if (spent) return { action: 'fail', reason: 'retry_already_spent' };

  const queue = RETRY_QUEUE_BY_STATUS[session.status];
  if (queue === 'transcription' && !session.audio_id) {
    return { action: 'fail', reason: 'no_audio_to_transcribe' };
  }
  return { action: 'retry', queue, reason: `requeue_${queue}` };
}

module.exports = {
  classifyStuckInitiatedSession,
  STUCK_INITIATED_MIN_AGE_MS,
  STUCK_INITIATED_MAX_AGE_MS,
  classifyStuckMidFlightSession,
  MIDFLIGHT_STUCK_AGE_MS,
  WATCHDOG_STATUSES,
  // bd-go4tl: the observe resume path re-enters the pipeline at the phase a
  // session died in too, so the map has one owner rather than two drifting copies.
  RETRY_QUEUE_BY_STATUS,
};
