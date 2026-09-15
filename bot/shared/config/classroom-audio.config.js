'use strict';
/**
 * What counts as a classroom recording, in one place.
 *
 * These numbers used to live as literals inside the voice handler, where the
 * routing branch is — and nowhere else. That is why the chat assistant could
 * invent a minimum: nothing near the model knew one existed, so when a teacher's
 * own voice note mentioned "fifteen to twenty seconds" (she was coaching a child
 * through a recording), the model had no rule to contradict her with and
 * repeated her sentence back as if it were ours.
 *
 * Every surface that states the minimum to a human now derives it from
 * CLASSROOM_AUDIO_THRESHOLD, so the copy and the branch cannot drift.
 *
 * ── On the duration signals, because they are not what they look like ───────
 *
 * WhatsApp never sends an audio duration. Measured over seven days on
 * production: 18,164 of 18,164 audio turns arrived with a reported duration of
 * zero. The Graph `/{media-id}` body carries url, mime_type, sha256, file_size
 * and id — no duration field exists to be unreliable.
 *
 * So the only real duration signal is ffprobe on the downloaded bytes, and that
 * runs only above LARGE_FILE_BYTES. Below that line the bot knows the byte count
 * and nothing else until the transcript comes back. Any rule written here must
 * therefore work from two signals — a probed duration when there is one, and the
 * transcript length when there is not.
 */

/** At or above this, the audio IS a classroom recording and starts a session. */
const CLASSROOM_AUDIO_THRESHOLD = 900;

/**
 * The ffprobe gate. A genuine voice question is under ~100 KB at typical opus
 * voice-note bitrates; anything at or above this is worth probing.
 */
const LARGE_FILE_BYTES = 500_000;

/**
 * The floor of the "looks like an attempted lesson" band. Under two minutes,
 * with no other signal, is conversation.
 */
const GUIDANCE_MIN_SECONDS = 120;

/**
 * The transcript-length boundary, and it is measured, not chosen. Thirty
 * transcripts hand-read from the 1,000-plus band were 27 lessons, 3 coach
 * debriefs and 0 chats. Thirty read from the 200-999 band were 18 chats, 7
 * classroom fragments, 3 children and 2 unclear. So 1,000 — a rule that fired at
 * 200 would lecture teachers who were asking questions.
 */
const GUIDANCE_MIN_TRANSCRIPT_CHARS = 1000;

/** The minimum as a human would say it. The single source of the number. */
function classroomMinimumMinutes() {
  return Math.round(CLASSROOM_AUDIO_THRESHOLD / 60);
}

module.exports = {
  CLASSROOM_AUDIO_THRESHOLD,
  LARGE_FILE_BYTES,
  GUIDANCE_MIN_SECONDS,
  GUIDANCE_MIN_TRANSCRIPT_CHARS,
  classroomMinimumMinutes,
};
