'use strict';
/**
 * bd-fgj73x.7 — a teacher's PORTAL Digital Coaching upload under 15 minutes gets no flow and no report.
 *
 * WhatsApp never starts a classroom session for audio under CLASSROOM_AUDIO_THRESHOLD (900 s). The portal
 * screen now holds a shorter recording back before Submit, but only when the browser can read its length
 * (some .amr/.3gp/.opus files it cannot). This is the server's half, for those: the transcription job
 * measures the bytes (ffprobe) right after the download and BEFORE the Step 1/5 message, the transcription
 * and the analysis. Under 900 s the row is closed `cancelled` — the duplicate-recording precedent
 * (audio-hash-cache) — with failed_step 'too_short' and its duration, and she gets a short generic message
 * on WhatsApp; the portal's progress shows the same line (shortRecording + stopped).
 *
 * Untouched: a WhatsApp recording and a coach's observation (not even measured), 900 s and over, and a
 * length that cannot be measured (fail open: analysed as before).
 */
const { CLASSROOM_AUDIO_THRESHOLD, classroomMinimumMinutes } = require('../../config/classroom-audio.config');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const { isPortalSession } = require('./portal-coaching.service');

/** A teacher's own DC upload from the portal — not a coach's observation, not a WhatsApp recording. */
function isPortalDc(session) {
  return !!session && !session.observation_type && isPortalSession(session);
}

/**
 * @param {{session, coachingSessionId, from, audioData}} ctx
 * @param {{probe, updateIfNotTerminal, getLanguage, sendMessage, log}} deps
 * @returns {Promise<{refused: boolean, seconds: number|null}>} refused: the caller must stop here
 */
async function refuseShortPortalRecording({ session, coachingSessionId, from, audioData }, deps = defaultDeps()) {
  const log = deps.log || (() => {});
  if (!isPortalDc(session)) return { refused: false, seconds: null };

  let probed = null;
  try {
    probed = await deps.probe(audioData);
  } catch (err) {
    log('⚠️ portal DC: length could not be measured — analysing as before', { coachingSessionId, error: err && err.message }, 'warn');
    return { refused: false, seconds: null };
  }
  if (!(Number(probed) > 0)) return { refused: false, seconds: null };
  const seconds = Math.round(probed);
  if (seconds >= CLASSROOM_AUDIO_THRESHOLD) return { refused: false, seconds };

  const { applied } = await deps.updateIfNotTerminal(coachingSessionId, {
    status: 'cancelled',
    failed_step: 'too_short',
    audio_duration_seconds: seconds,
    error_message: `recording ${seconds}s is under the ${CLASSROOM_AUDIO_THRESHOLD}s minimum`,
  });
  if (!applied) {
    log('🚫 portal DC: too short, but the session is already over — nothing sent', { coachingSessionId, seconds });
    return { refused: true, seconds };
  }

  try {
    const language = clampLanguage(await deps.getLanguage(session.user_id));
    await deps.sendMessage(from, resolveUx('coachingPortalRecordingTooShort', { language, params: { min: classroomMinimumMinutes() } }));
  } catch (err) {
    // The session stays closed: the portal shows the same line. Loud, because she may not know why.
    log('❌ portal DC: too-short message not delivered on WhatsApp (the portal shows it)', { coachingSessionId, error: err && err.message }, 'error');
  }
  log('⏱️ portal DC: recording under the minimum — no analysis, no report', { coachingSessionId, seconds, minimum: CLASSROOM_AUDIO_THRESHOLD });
  return { refused: true, seconds };
}

function defaultDeps() {
  const { logToFile } = require('../../utils/logger');
  return {
    probe: (buf) => require('../audio.service').getAudioDuration(buf),
    updateIfNotTerminal: (id, fields) => require('./session-terminal').updateIfNotTerminal(id, fields),
    getLanguage: async (userId) => require('../../utils/language-cache').getUserLanguage(userId),
    sendMessage: (to, body) => require('../whatsapp.service').sendMessage(to, body),
    log: logToFile,
  };
}

module.exports = { isPortalDc, refuseShortPortalRecording };
