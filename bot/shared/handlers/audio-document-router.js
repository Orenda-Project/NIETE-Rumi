/**
 * Audio-document router — classification helpers for handleDocumentMessage.
 *
 * Context: WhatsApp voice messages cap at 16MB, but WhatsApp documents allow up to 100MB.
 * We accept audio-as-document to let teachers upload longer classroom recordings.
 * Whisper (our transcription engine) caps at 25MB per file, so anything larger
 * than 25MB must be rejected here — we cannot chunk yet (roadmap).
 *
 * Pure functions only — no I/O, no logging. Callers own logging + side effects.
 */

// Rumi's transcription engine (OpenAI Whisper) hard limit.
const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// WhatsApp Cloud API document upload ceiling.
const WHATSAPP_DOCUMENT_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

// Substrings that mark a document as audio. Kept identical to the pattern
// used by whatsapp-bot.js:1566 so behaviour is consistent, plus explicit
// coverage for the container/codec MIME types Meta actually emits.
const AUDIO_MIME_TOKENS = ['audio', 'm4a', 'mp3', 'mpeg', 'wav', 'ogg', 'webm', 'aac', 'opus'];

/**
 * Is the given MIME type an audio MIME?
 * @param {string|undefined|null} mimeType
 * @returns {boolean}
 */
function isAudioMimeType(mimeType) {
  if (!mimeType || typeof mimeType !== 'string') return false;
  const lower = mimeType.toLowerCase();
  return AUDIO_MIME_TOKENS.some((tok) => lower.includes(tok));
}

/**
 * Classify an incoming WhatsApp document.
 *
 * Returns one of:
 *   { decision: 'not_audio' }
 *       — MIME does not look like audio; caller keeps existing document flow (PDF etc.).
 *   { decision: 'reject_too_large', sizeMB }
 *       — audio, but > 25MB Whisper limit; caller must send the friendly reject message.
 *   { decision: 'route_to_audio_pipeline', sizeMB }
 *       — audio ≤ 25MB; caller can safely download + probe duration + route to coaching/voice.
 *
 * Missing/zero fileSize is treated as "unknown but proceed" — we let the existing
 * download+ffprobe path run and fail loudly there if the file is malformed,
 * rather than pre-rejecting legitimate uploads whose file_size WA omitted.
 *
 * @param {{ mimeType?: string, fileSize?: number }} doc
 * @returns {{ decision: string, sizeMB?: string }}
 */
function classifyAudioDocument({ mimeType, fileSize } = {}) {
  if (!isAudioMimeType(mimeType)) {
    return { decision: 'not_audio' };
  }

  const size = typeof fileSize === 'number' && fileSize > 0 ? fileSize : null;

  if (size !== null && size > WHISPER_MAX_BYTES) {
    return {
      decision: 'reject_too_large',
      sizeMB: (size / (1024 * 1024)).toFixed(1),
    };
  }

  return {
    decision: 'route_to_audio_pipeline',
    sizeMB: size !== null ? (size / (1024 * 1024)).toFixed(1) : null,
  };
}

/**
 * Build the user-facing reject message for an oversize audio document.
 * Extracted so it's assertable in tests without string-matching against the handler.
 * @param {string} sizeMB
 * @returns {string}
 */
function buildTooLargeMessage(sizeMB) {
  return (
    `This audio file is ${sizeMB} MB. Rumi's transcription engine currently ` +
    `caps at 25MB per file — please compress or split into smaller sections ` +
    `(30-min chunks at voice quality typically fit). Chunked long-recording ` +
    `support is on the roadmap.`
  );
}

module.exports = {
  classifyAudioDocument,
  isAudioMimeType,
  buildTooLargeMessage,
  WHISPER_MAX_BYTES,
  WHATSAPP_DOCUMENT_MAX_BYTES,
};
