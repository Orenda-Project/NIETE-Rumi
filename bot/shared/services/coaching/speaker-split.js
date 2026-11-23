'use strict';
/**
 * bd-s192t.12 — was this lesson recording split into teacher vs children speech?
 *
 * Soniox's diarization sometimes puts a whole lesson on one speaker, or on two speakers that barely alternate. Eval
 * #230 (NIETE prod, 7 Sep-23 Nov 2026): 5.3% of lesson recordings of 5+ minutes, flat every week, on app and WhatsApp
 * alike. The transcript then reads "Teacher:" on every line, the FICO scorer finds no child speech, and the same
 * teacher's unsplit lessons score 3.4 points lower than her split ones.
 *
 * Pure: no I/O. `speakerSplitFor` reads the UNSPLIT_SPEAKER_NOTE switch (off unless 'true').
 */

const MIN_SECONDS = 300;        // shorter recordings are not judged
const MIN_TURNS_PER_MIN = 1;    // eval #230's line for "never split"

/**
 * @param {{segments?: Array<{label?: string, speaker?: string}>}|null} diarization  coaching_sessions.diarization_data
 * @param {number|null} durationSec  coaching_sessions.audio_duration_seconds
 * @returns {{split: boolean, reason: 'one_voice'|'few_turns'|null, turnsPerMin: number}|null} null = not judged
 */
function speakerSplit(diarization, durationSec) {
  const secs = Number(durationSec);
  if (!Number.isFinite(secs) || secs < MIN_SECONDS) return null;
  const segments = diarization && Array.isArray(diarization.segments) ? diarization.segments : null;
  if (!segments) return null;
  const voices = new Set(segments.map((s) => (s && (s.label || s.speaker)) || 'unknown'));
  const turnsPerMin = (segments.length * 60) / secs;
  const reason = voices.size <= 1 ? 'one_voice' : turnsPerMin < MIN_TURNS_PER_MIN ? 'few_turns' : null;
  return { split: reason === null, reason, turnsPerMin };
}

/** The verdict for a coaching_sessions row, or null while the switch is off. */
function speakerSplitFor(session, env = process.env) {
  if (!env || env.UNSPLIT_SPEAKER_NOTE !== 'true' || !session) return null;
  let d = session.diarization_data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_e) { d = null; } }
  return speakerSplit(d, session.audio_duration_seconds);
}

module.exports = { speakerSplit, speakerSplitFor, MIN_SECONDS, MIN_TURNS_PER_MIN };
