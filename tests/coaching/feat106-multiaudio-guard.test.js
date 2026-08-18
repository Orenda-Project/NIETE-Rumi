/**
 * FEAT-106 #3 (bd-2376) — multi-audio / stuck-session guard.
 *
 * M. Salman (ICT, DC-5): sending a SECOND classroom recording while the first
 * was still being analysed started a fresh session and repeated the questions.
 * The classroom-audio branch only recognised a session in 'conducting_conversation'
 * (the reflective phase); any other mid-flight state fell through and began a
 * brand-new analysis.
 *
 * shouldDeferNewClassroomAudio() decides, from the teacher's latest session,
 * whether a new classroom recording should be DEFERRED (ack + no restart)
 * because an analysis is already running for her.
 */

const {
  isMidFlightCoachingStatus,
  shouldDeferNewClassroomAudio,
  MIDFLIGHT_WINDOW_MS,
} = require('../../bot/shared/services/coaching/coaching-inflight-guard');

const NOW = 1_700_000_000_000;

describe('FEAT-106 #3 — isMidFlightCoachingStatus', () => {
  it('treats analysis/processing states as mid-flight', () => {
    for (const s of ['initiated', 'confirmed', 'transcribing', 'analyzing', 'analysis_started', 'generating_report']) {
      expect(isMidFlightCoachingStatus(s)).toBe(true);
    }
  });
  it('treats terminal states as NOT mid-flight', () => {
    for (const s of ['completed', 'failed', 'cancelled']) {
      expect(isMidFlightCoachingStatus(s)).toBe(false);
    }
  });
  // bd-o29gk: awaiting_* are WAITING-FOR-THE-TEACHER states, NOT processing.
  it('treats waiting-for-teacher states (awaiting_*) as NOT mid-flight', () => {
    for (const s of ['awaiting_photo', 'awaiting_classroom_photo', 'awaiting_lesson_plan']) {
      expect(isMidFlightCoachingStatus(s)).toBe(false);
    }
  });
});

describe('FEAT-106 #3 — shouldDeferNewClassroomAudio', () => {
  it('defers a new recording while a recent analysis is mid-flight', () => {
    const session = { status: 'analyzing', created_at: new Date(NOW - 60_000).toISOString() };
    expect(shouldDeferNewClassroomAudio(session, NOW)).toBe(true);
  });

  it('does NOT defer when the previous session already completed', () => {
    const session = { status: 'completed', created_at: new Date(NOW - 60_000).toISOString() };
    expect(shouldDeferNewClassroomAudio(session, NOW)).toBe(false);
  });

  it('does NOT defer when there is no previous session', () => {
    expect(shouldDeferNewClassroomAudio(null, NOW)).toBe(false);
  });

  // bd-o29gk: a session waiting for the teacher's photo/lesson-plan must let a NEW recording
  // through (start fresh), even if recent — the system is not processing, it is waiting for her.
  it('does NOT defer a RECENT session that is only waiting for a photo / lesson plan', () => {
    for (const status of ['awaiting_photo', 'awaiting_classroom_photo', 'awaiting_lesson_plan']) {
      const session = { status, created_at: new Date(NOW - 60_000).toISOString() };
      expect(shouldDeferNewClassroomAudio(session, NOW)).toBe(false);
    }
  });

  it('does NOT defer a STALE mid-flight session (older than the window) — lets a genuine new recording through', () => {
    const session = { status: 'analyzing', created_at: new Date(NOW - MIDFLIGHT_WINDOW_MS - 1000).toISOString() };
    expect(shouldDeferNewClassroomAudio(session, NOW)).toBe(false);
  });

  it('defers a mid-flight session with an unparseable timestamp (safer default)', () => {
    const session = { status: 'analysis_started', created_at: null };
    expect(shouldDeferNewClassroomAudio(session, NOW)).toBe(true);
  });
});
