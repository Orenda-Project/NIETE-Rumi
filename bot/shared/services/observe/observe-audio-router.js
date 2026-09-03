/**
 * FEAT-053 bd-29 — the ONE place that decides what a school leader's audio means.
 *
 * WHY THIS EXISTS: audio reaches the bot through TWO entry points —
 *   1. a WhatsApp voice note  → voice-message.handler
 *   2. an audio FILE/document → the document branch in the webhook entry point
 * A phone recorder app delivers a 40-minute lesson as a FILE, so path 2 is the
 * NORMAL way a field officer sends a classroom recording. The original /observe
 * build only intercepted path 1, so file-sent recordings sailed past /observe
 * and into the TEACHER coaching flow (caught on staging 2026-07-12).
 *
 * bd-tju8f (prod 2026-08-24): the webhook NEVER carries an audio duration
 * (1,000 webhooks sampled: zero had one; `voice` is a boolean on
 * message.audio), so the old `isLongAudio` computed from it was ALWAYS false
 * and the no-state wall was inert for voice notes — a coach's second recording
 * of the day (slot busy) fell into teacher coaching. Four coaches leaked in one
 * morning. The router now resolves the duration ITSELF (getMediaInfo + the
 * ffprobe fallback the DC path has used for months) and, when nothing is
 * armed, PARKS the recording and ASKS whose it is (observe-binding.service) —
 * never a guess, never teacher coaching, never a dead-end nudge.
 *
 * Invariant: a school leader's classroom-length audio NEVER starts a teacher
 * coaching session — not on a lost state, not on a Redis blip, not on a
 * capture failure, not on an unresolvable duration with a large file.
 */

const WhatsAppService = require('../whatsapp.service');
const ObserveState = require('./observe-state.service');
const { observeStrings, observeLang } = require('./observe-strings');
const { isSchoolLeader } = require('./observe-gate');
const { logToFile } = require('../../utils/logger');

const CLASSROOM_SECONDS = 900;       // same 15-min line the DC path draws
const LARGE_FILE_BYTES = 500_000;    // the DC path's "suspiciously large" line

/**
 * Resolve the REAL duration: caller-supplied → getMediaInfo → ffprobe bytes.
 * Returns { dur, fileSize } — dur 0 when genuinely unresolvable.
 */
async function _resolveDuration(audioId, durationSeconds) {
  let dur = Number(durationSeconds) || 0;
  let fileSize = 0;
  if (dur) return { dur, fileSize };
  try {
    const meta = await WhatsAppService.getMediaInfo(audioId);
    dur = Math.round(meta?.audio?.duration || meta?.voice?.duration || 0);
    fileSize = meta?.file_size || 0;
    if (!dur && fileSize >= LARGE_FILE_BYTES) {
      const buf = await WhatsAppService.downloadMedia(audioId);
      const AudioService = require('../audio.service');
      dur = Math.round(await AudioService.getAudioDuration(buf));
    }
  } catch (err) {
    logToFile('⚠️ observe: duration probe failed for leader audio', {
      audioId, error: err.message,
    });
  }
  return { dur, fileSize };
}

/**
 * @param {object}  opts.user         users row (may be null)
 * @param {string}  opts.from         WhatsApp sender
 * @param {string}  opts.audioId      media id (voice note id OR document id)
 * @param {string}  opts.sessionId    chat session id
 * @param {boolean} opts.isLongAudio  caller's legacy signal (document path
 *                                    already probed) — trusted when true
 * @param {number}  opts.durationSeconds  caller-resolved duration, if any
 * @param {string}  opts.sha256       webhook checksum (dedupe), if any
 * @param {string}  opts.mimeType     webhook MIME (audio/ogg voice note,
 *                                    audio/aac document…) — bd-2kxxa.3: stored
 *                                    with a debrief so the worker keeps the
 *                                    real container extension
 * @returns {Promise<boolean>} handled? (true → caller returns immediately)
 */
async function routeLeaderAudio({ user, from, audioId, sessionId, isLongAudio = false, durationSeconds = null, sha256 = null, mimeType = null }) {
  // FEAT-102 dark-safe gate: no published observe Flow → the whole capability
  // is off and leaders' audio flows through normal coaching exactly as before.
  if (!process.env.OBSERVE_MEWAKA_FLOW_ID) return false;
  if (!isSchoolLeader(user)) return false;   // teachers untouched (family check — bd-46)

  const lang = observeLang(user);
  const S = observeStrings(lang);

  const { dur, fileSize } = await _resolveDuration(audioId, durationSeconds);
  // Classroom-recording test: resolved-long, OR unresolvable-but-large, OR the
  // caller already probed it long. A resolved-short small file is the coach
  // TALKING to Rumi — that stays chat.
  const looksLikeClassroom = dur >= CLASSROOM_SECONDS
    || (!dur && fileSize >= LARGE_FILE_BYTES)
    || isLongAudio;

  const park = async () => {
    const ObserveBinding = require('./observe-binding.service');
    await ObserveBinding.parkAndAsk(user, from, {
      audioId, sha256, durationSeconds: dur || null, mimeType,
    });
  };

  let state = null;
  try {
    state = await ObserveState.getState(user.id);
  } catch (err) {
    logToFile('⚠️ observe: state lookup failed for leader audio', {
      userId: user.id, error: err.message,
    });
    // Fail SAFE: a state error must never open the teacher-coaching door.
    if (looksLikeClassroom) { await park(); return true; }
    return false;
  }

  try {
    if (state && state.state === 'awaiting_audio') {
      const ObserveCapture = require('./observe-capture.service');
      // bd-2139: pass the resolved duration through. Dropping it stored
      // audio_duration_seconds = NULL ("your 0-minute recording").
      await ObserveCapture.startFromAudio(user, from, audioId, sessionId, dur || null);
      logToFile('🔭 observe: classroom recording captured', { userId: user.id, audioId });
      return true;
    }
    if (state && state.state === 'awaiting_debrief_audio') {
      const ObserveDebrief = require('./observe-debrief.service');
      await ObserveDebrief.startDebriefFromAudio(user, from, audioId, state, { mimeType });
      logToFile('🎙 observe: debrief recording captured', { userId: user.id, audioId });
      return true;
    }
  } catch (err) {
    logToFile('❌ observe: leader audio capture failed', {
      userId: user.id, state: state && state.state, error: err.message,
    });
    await WhatsAppService.sendMessage(from, S.debrief_load_error);
    return true;   // never fall through into teacher coaching on an error
  }

  // Nothing armed (or the slot is mid-pipeline on ANOTHER observation — the
  // multi-flight case). A classroom-length recording is parked and the coach
  // is ASKED whose it is. bd-pkds0: this replaces the duration-gated wall.
  if (looksLikeClassroom) {
    logToFile('🔭 observe: unbound leader recording — asking whose it is', {
      userId: user.id, audioId, dur, slotState: state && state.state,
    });
    await park();
    return true;   // the invariant: never teacher coaching for a school leader
  }

  // Resolved-short, small file: the coach is talking to Rumi. Chat continues.
  return false;
}

module.exports = { routeLeaderAudio };
