/**
 * FEAT-106 #3 (bd-2376) — multi-audio / stuck-session guard.
 *
 * A teacher who sent a SECOND classroom recording while the first was still
 * being analysed (M. Salman, ICT, DC-5) got a fresh session started and the
 * questions repeated. The classroom-audio branch only recognised a session in
 * 'conducting_conversation'; every other in-progress state fell through and
 * kicked off a brand-new analysis.
 *
 * These pure helpers let the handler DEFER a new recording (ack, don't restart)
 * while an analysis is already running for her — but still let a genuinely new
 * recording through once the previous one finished or went stale (so a stuck
 * session can never trap her forever).
 */

// In-progress statuses: an analysis is actively running / awaiting an input.
// (conducting_conversation is handled earlier as a reflective answer, so it is
// intentionally NOT here.) Terminal states — completed / failed / cancelled —
// are absent, so a new recording after any of them starts fresh.
const MIDFLIGHT_STATUSES = new Set([
  'initiated',
  'confirmed',
  'pending',
  'transcribing',
  'transcription_complete',
  'analyzing',
  'analysis_started',
  'analysis_complete',
  'generating_report',
  // bd-o29gk: the "awaiting_*" states (awaiting_photo, awaiting_classroom_photo,
  // awaiting_lesson_plan) are DELIBERATELY NOT here. They are WAITING-FOR-THE-TEACHER
  // states, not processing — the system is idle, waiting for her to send a photo or a
  // lesson plan. Treating them as mid-flight told a teacher stuck at the photo/LP gate
  // "I'm still analysing your previous recording. Hang tight." on every new recording,
  // so she could never recover, and onboarding stalled (R60/R61/R62, ~40 stuck teachers
  // 2026-08-18). A NEW recording while waiting-for-teacher must start a fresh session.
]);

// After this long, a mid-flight session is treated as stuck — a new recording
// is allowed through rather than deferred, so a stalled analysis (e.g. one that
// died in the 2026-07-23 transcription outage) can't trap the teacher.
const MIDFLIGHT_WINDOW_MS = 30 * 60 * 1000;

function isMidFlightCoachingStatus(status) {
  return MIDFLIGHT_STATUSES.has(String(status || ''));
}

/**
 * @param {object|null} session  the teacher's latest coaching session row
 * @param {number} nowMs         current time (injected for testability)
 * @returns {boolean} true = defer the new recording (ack, do not start a new session)
 */
function shouldDeferNewClassroomAudio(session, nowMs = Date.now()) {
  if (!session || !isMidFlightCoachingStatus(session.status)) return false;
  // bd-0c80s: a bound observe capture puts the TEACHER's user_id on the row
  // (observation_type='leader_observation'). That is a coach observing her,
  // not her own analysis — it must never bounce her own recording.
  if (session.observation_type === 'leader_observation') return false;
  const stamp = Date.parse(session.created_at || session.updated_at || '');
  if (Number.isNaN(stamp)) return true; // mid-flight but unknown age → defer (safer)
  return (nowMs - stamp) <= MIDFLIGHT_WINDOW_MS;
}

module.exports = {
  MIDFLIGHT_STATUSES,
  MIDFLIGHT_WINDOW_MS,
  isMidFlightCoachingStatus,
  shouldDeferNewClassroomAudio,
};
