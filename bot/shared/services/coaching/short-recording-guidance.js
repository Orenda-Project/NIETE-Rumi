'use strict';
/**
 * When a recording that is not long enough to analyse should be TOLD so — and
 * when it should be left completely alone.
 *
 * Nothing here refuses anything. A sub-threshold recording already goes to the
 * chat assistant, by design, and it still does. What this adds is one honest
 * sentence, before the chat answer, for the recordings that look like an
 * attempted lesson.
 *
 * ── Why the rule has to be this narrow ──────────────────────────────────────
 *
 * Most short audio on this deployment is genuinely conversation: roughly three
 * in four audio turns fall through to chat. Measured over seven days,
 * 1,009 recordings landed between 30 and 899 probed seconds and got a chat
 * answer with no guidance — and 544 of those were between ten and fifteen
 * minutes, which is not an aside. But thirty transcripts hand-read from the
 * 200-999 character band were 18 conversations. So the boundary sits at 1,000
 * characters, where 30 of 30 read transcripts were lessons or coach debriefs and
 * none was a teacher asking a question.
 *
 * A rule that fires on a teacher's question is worse than no rule: she asked
 * something and got a lecture about length.
 *
 * ── The three tiers ─────────────────────────────────────────────────────────
 *
 *   1  She DECLARED it — she tapped Classroom Coaching and was told to send a
 *      recording. Guidance at any length, unconditionally: she asked for an
 *      analysis and deserves to be told why she is not getting one.
 *   2  It SOUNDS like one — a probed duration inside the band, or a transcript
 *      long enough that nothing else explains it. Guidance, with the explicit
 *      escape ("if you only meant to chat, carry on").
 *   3  Everything else — untouched.
 *
 * Gated on the self-coaching capability rather than on "is this a school
 * leader". A coach's eight-minute debrief recording must never be told it needs
 * fifteen minutes (three of the thirty long transcripts were exactly that), but
 * a principal here genuinely records her own lessons, and a leader gate would
 * silence the guidance for the people most likely to need it.
 */

const { canSelfCoach } = require('../../config/role-features');
const { hasDeclaredDcIntent } = require('../observe/observe-audio-router');
const {
  CLASSROOM_AUDIO_THRESHOLD,
  GUIDANCE_MIN_SECONDS,
  GUIDANCE_MIN_TRANSCRIPT_CHARS,
  classroomMinimumMinutes,
} = require('../../config/classroom-audio.config');

const NONE = Object.freeze({ tier: null, reason: 'chat' });

/**
 * Pure. No IO, no throw.
 *
 * `durationSeconds` is null or 0 whenever nothing probed the bytes — WhatsApp
 * never reports a duration, and ffprobe runs only above the large-file line, so
 * a truthy value here already means "somebody measured this".
 *
 * @param {object}  opts
 * @param {object|null} opts.user             the users row
 * @param {number|null} opts.durationSeconds  probed duration, if any
 * @param {number}      opts.transcriptChars  transcript length in code points
 * @returns {{tier: 1|2|null, reason: string}}
 */
function classifyShortRecording({ user, durationSeconds, transcriptChars = 0 }) {
  if (!user) return NONE;
  if (!canSelfCoach(user)) return NONE;

  const dur = Number(durationSeconds) || 0;
  // At or above the threshold this is a real session and never reaches here.
  if (dur >= CLASSROOM_AUDIO_THRESHOLD) return NONE;

  if (hasDeclaredDcIntent(user)) return { tier: 1, reason: 'declared_dc_intent' };

  if (dur >= GUIDANCE_MIN_SECONDS) return { tier: 2, reason: 'probed_duration_in_band' };
  if (Number(transcriptChars) >= GUIDANCE_MIN_TRANSCRIPT_CHARS) {
    return { tier: 2, reason: 'transcript_length' };
  }

  return NONE;
}

/**
 * The catalog key and its parameters for a classification.
 *
 * Four keys rather than two because the duration is genuinely unknown on the
 * unprobed path, and copy that names a length it does not have is the failure
 * this change exists to remove. A message must name the actual state.
 *
 * @returns {{key: string, params: object}|null}
 */
function guidanceCopyFor({ tier, durationSeconds }) {
  if (tier !== 1 && tier !== 2) return null;
  const dur = Number(durationSeconds) || 0;
  const min = classroomMinimumMinutes();
  const known = dur > 0;
  const minutes = known ? Math.max(1, Math.round(dur / 60)) : null;

  if (tier === 1) {
    return known
      ? { key: 'coachingRecordingTooShort', params: { minutes, min } }
      : { key: 'coachingRecordingTooShortUnknownLength', params: { min } };
  }
  return known
    ? { key: 'coachingRecordingLooksShort', params: { minutes, min } }
    : { key: 'coachingRecordingLooksShortUnknownLength', params: { min } };
}

module.exports = {
  classifyShortRecording,
  guidanceCopyFor,
  GUIDANCE_MIN_SECONDS,
  GUIDANCE_MIN_TRANSCRIPT_CHARS,
};
