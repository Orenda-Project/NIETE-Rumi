/**
 * bd-j3j4b — auto-advance predicate for sessions stranded at the photo/LP gate.
 */
const { PHOTO_GATE_STATUSES, shouldAutoAdvancePhotoGate } = require('../../bot/shared/services/coaching/photo-gate-sweep');

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const stuck = (status, ageMs, extra = {}) => ({ status, transcript_text: 'a class transcript', created_at: new Date(NOW - ageMs).toISOString(), ...extra });

describe('bd-j3j4b — shouldAutoAdvancePhotoGate', () => {
  it('covers exactly the three gate statuses', () => {
    expect(PHOTO_GATE_STATUSES).toEqual(['awaiting_photo', 'awaiting_classroom_photo', 'awaiting_lesson_plan']);
  });

  it('auto-advances a gate session stuck past the threshold (has transcript)', () => {
    for (const s of PHOTO_GATE_STATUSES) {
      expect(shouldAutoAdvancePhotoGate(stuck(s, 2 * HOUR), NOW, HOUR)).toBe(true);
    }
  });

  it('does NOT advance a session still within the threshold', () => {
    expect(shouldAutoAdvancePhotoGate(stuck('awaiting_photo', 10 * 60 * 1000), NOW, HOUR)).toBe(false);
  });

  it('does NOT advance a session with no transcript (no audio → nothing to report)', () => {
    expect(shouldAutoAdvancePhotoGate({ status: 'awaiting_photo', transcript_text: null, created_at: new Date(NOW - 3 * HOUR).toISOString() }, NOW, HOUR)).toBe(false);
  });

  it('does NOT advance a non-gate status (e.g. conducting_conversation, completed)', () => {
    expect(shouldAutoAdvancePhotoGate(stuck('conducting_conversation', 5 * HOUR), NOW, HOUR)).toBe(false);
    expect(shouldAutoAdvancePhotoGate(stuck('completed', 5 * HOUR), NOW, HOUR)).toBe(false);
  });

  it('does NOT advance when the timestamp is unparseable (safer: leave it)', () => {
    expect(shouldAutoAdvancePhotoGate({ status: 'awaiting_photo', transcript_text: 't', created_at: null }, NOW, HOUR)).toBe(false);
  });

  it('null session → false', () => {
    expect(shouldAutoAdvancePhotoGate(null, NOW, HOUR)).toBe(false);
  });
});

/**
 * bd-5knlj — the 60-minute default is tuned for teacher self-record. On a
 * LEADER OBSERVATION the coach is mid-school-visit and answers the LP prompt
 * hours later; sweeping at 60 minutes threw away her Section B (96 of 379
 * broken observations, Aug 24 – Sep 1). Observations get their own, longer
 * threshold.
 */
const { gateThresholdFor } = require('../../bot/shared/services/coaching/photo-gate-sweep');

describe('gateThresholdFor (bd-5knlj)', () => {
  const HOUR = 60 * 60 * 1000;
  it('a leader observation waits 8 hours by default', () => {
    expect(gateThresholdFor({ observation_type: 'leader_observation' }, {})).toBe(8 * HOUR);
  });
  it('a teacher self-record keeps the 60-minute default', () => {
    expect(gateThresholdFor({ observation_type: null }, {})).toBe(HOUR);
  });
  it('both are env-tunable, independently', () => {
    const env = { OBSERVE_LP_GATE_MINUTES: '720', COACHING_PHOTO_GATE_MINUTES: '90' };
    expect(gateThresholdFor({ observation_type: 'leader_observation' }, env)).toBe(720 * 60000);
    expect(gateThresholdFor({}, env)).toBe(90 * 60000);
  });
});
