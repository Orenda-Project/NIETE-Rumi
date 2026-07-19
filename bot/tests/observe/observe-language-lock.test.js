/**
 * FEAT-053 bd-31 — an observer's language is THEIR preference, not the
 * classroom's.
 *
 * Sabeena (2026-07-14): "there are some letters in Urdu. Please don't switch
 * the language. Keep it Swahili."
 *
 * The transcription pipeline auto-detects the language of the recording and
 * OVERWRITES users.preferred_language with it. For a teacher recording her own
 * class that is sensible. For a school leader it is not: the audio is SOMEONE
 * ELSE'S lesson. A field officer who observes an Urdu (or English, or Kiswahili)
 * classroom would have their entire interface silently re-languaged to whatever
 * the teacher happened to speak.
 *
 * Contract, pinned at the source: the leader-observation path must never call
 * setUserLanguage.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../shared/services/coaching/transcription-processor.service.js'),
  'utf8',
);

describe('observer language is never overwritten by the lesson (bd-31)', () => {
  test('the language-update branch is gated on NOT being a leader observation', () => {
    // the guard must exist and be derived from the session row (never a payload)
    expect(SRC).toMatch(/observation_type\s*===\s*'leader_observation'/);
    expect(SRC).toMatch(/!isLeaderObservation\s*&&\s*languageAnalysis\.shouldUpdate/);
  });

  test('setUserLanguage is not reachable without passing that gate', () => {
    // the only call site sits inside the !isLeaderObservation branch
    const guardAt = SRC.indexOf('!isLeaderObservation && languageAnalysis.shouldUpdate');
    const callAt = SRC.indexOf('setUserLanguage(session.user_id');
    expect(guardAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(guardAt);
  });

  test('teachers are unaffected — the auto-switch still exists for normal coaching', () => {
    expect(SRC).toMatch(/setUserLanguage\(session\.user_id, languageAnalysis\.newLanguage\)/);
  });
});
