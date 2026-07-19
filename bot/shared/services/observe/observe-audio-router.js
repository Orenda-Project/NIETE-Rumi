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
 * Both handlers now call routeLeaderAudio() FIRST. If it returns true it has
 * fully handled the audio and the caller must stop.
 *
 * Invariant: a school leader's long audio NEVER starts a teacher coaching
 * session — not on a lost state, not on a Redis blip, not on a capture failure.
 */

const WhatsAppService = require('../whatsapp.service');
const ObserveState = require('./observe-state.service');
const { observeStrings, observeLang } = require('./observe-strings');
const { isSchoolLeader } = require('./observe-gate');
const { logToFile } = require('../../utils/logger');

/**
 * @param {object}  opts.user         users row (may be null)
 * @param {string}  opts.from         WhatsApp sender
 * @param {string}  opts.audioId      media id (voice note id OR document id)
 * @param {string}  opts.sessionId    chat session id
 * @param {boolean} opts.isLongAudio  true when the caller would otherwise route
 *                                    this audio into classroom coaching
 * @returns {Promise<boolean>} handled? (true → caller returns immediately)
 */
async function routeLeaderAudio({ user, from, audioId, sessionId, isLongAudio = false }) {
  if (!isSchoolLeader(user)) return false;   // teachers untouched (family check — bd-46)

  const lang = observeLang(user);
  const S = observeStrings(lang);

  let state = null;
  try {
    state = await ObserveState.getState(user.id);
  } catch (err) {
    logToFile('⚠️ observe: state lookup failed for leader audio', {
      userId: user.id, error: err.message,
    });
    // Fail SAFE: on a long recording we still refuse to hand a school leader
    // to the teacher coaching flow — nudge them to re-arm instead.
    if (isLongAudio) {
      await WhatsAppService.sendMessage(from, S.long_audio_no_state);
      return true;
    }
    return false;
  }

  try {
    if (state && state.state === 'awaiting_audio') {
      const ObserveCapture = require('./observe-capture.service');
      await ObserveCapture.startFromAudio(user, from, audioId, sessionId);
      logToFile('🔭 observe: classroom recording captured', { userId: user.id, audioId });
      return true;
    }
    if (state && state.state === 'awaiting_debrief_audio') {
      const ObserveDebrief = require('./observe-debrief.service');
      await ObserveDebrief.startDebriefFromAudio(user, from, audioId, state);
      logToFile('🎙 observe: debrief recording captured', { userId: user.id, audioId });
      return true;
    }
  } catch (err) {
    logToFile('❌ observe: leader audio capture failed', {
      userId: user.id, state: state && state.state, error: err.message,
    });
    if (isLongAudio) {
      // Still never fall through into teacher coaching.
      await WhatsAppService.sendMessage(from, S.debrief_load_error);
      return true;
    }
    return false;
  }

  // School leader, no observe state armed.
  if (isLongAudio) {
    logToFile('🔭 observe: leader sent long audio with no armed observation', { userId: user.id });
    await WhatsAppService.sendMessage(from, S.long_audio_no_state);
    return true;   // the invariant: never teacher coaching for a school leader
  }

  return false;    // short audio, no observation — let them chat normally
}

module.exports = { routeLeaderAudio };
