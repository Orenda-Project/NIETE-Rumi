'use strict';
/**
 * bd-brblff — is this transcription failure one a retry can never fix?
 *
 * AudioService._transcribeOnce tries Soniox v3, then Soniox v2, then Whisper, and when all three fail it throws
 * one Error whose message lists each provider's own error on its own line:
 *
 *   All transcription methods failed:
 *   - Soniox V3: <error>
 *   - Soniox V2: <error>
 *   - OpenAI Whisper: <error>
 *
 * When EVERY one of the three says the bytes cannot be decoded, the file itself is broken (27 Nov 2026: an
 * Android m4a never finished, with no moov box; 25 Nov: a 0-byte upload). Delivering the job again sends the
 * same bytes to the same three providers and fails the same way, so the job is marked permanent and the
 * worker removes its message (sqs-worker handleJobFailure caller). Anything less than all three saying so (a
 * timeout, a rate limit, a network error, an unexpected text) is NOT permanent: it is retried exactly as before.
 */

const PERMANENT_REASON = 'unreadable_audio';

// Soniox's own error type for a file it cannot analyse.
const SONIOX_UNREADABLE = /\binvalid_audio_file\b/;
// OpenAI's 400 texts for bytes it cannot decode or a container it does not recognise.
const WHISPER_UNREADABLE = /could not be decoded|Invalid file format/i;

function providerLine(message, label) {
  const line = String(message).split('\n').find((l) => l.startsWith(`- ${label}:`));
  return line || null;
}

/**
 * @param {Error|null|undefined} error
 * @returns {boolean} true only when all three transcribers refused the bytes as undecodable
 */
function isUnreadableAudioError(error) {
  const message = error && error.message;
  if (typeof message !== 'string' || !message.startsWith('All transcription methods failed')) return false;
  const v3 = providerLine(message, 'Soniox V3');
  const v2 = providerLine(message, 'Soniox V2');
  const whisper = providerLine(message, 'OpenAI Whisper');
  return !!(v3 && v2 && whisper
    && SONIOX_UNREADABLE.test(v3)
    && SONIOX_UNREADABLE.test(v2)
    && WHISPER_UNREADABLE.test(whisper));
}

/**
 * Mark an unreadable-audio error permanent, in place, so the worker does not leave its message for SQS to
 * deliver again. Any other error is returned untouched.
 * @param {Error} error
 * @returns {Error} the same error
 */
function markPermanentIfUnreadable(error) {
  if (isUnreadableAudioError(error)) {
    error.permanent = true;
    error.permanentReason = PERMANENT_REASON;
  }
  return error;
}

module.exports = { isUnreadableAudioError, markPermanentIfUnreadable, PERMANENT_REASON };
