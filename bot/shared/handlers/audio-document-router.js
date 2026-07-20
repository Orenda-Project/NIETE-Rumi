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

// Transcription cap. The coaching pipeline transcribes with Soniox (primary —
// handles long/large files); OpenAI Whisper is only a fallback. So the real
// ceiling is what WhatsApp lets a teacher upload as a document (100 MB), NOT
// Whisper's 25 MB. bd-2134 (Riffat, 2026-07-20): a 27 MB classroom recording
// was pre-rejected at 25 MB even though Soniox transcribes it fine.
const WHISPER_MAX_BYTES = 100 * 1024 * 1024; // 100 MB (Soniox-safe; = WhatsApp doc ceiling)

// WhatsApp Cloud API document upload ceiling.
const WHATSAPP_DOCUMENT_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

// Substrings that mark a document as audio. bd-2134: 'mp4' added — WhatsApp
// labels a .mp4 (INCLUDING audio-only recordings shared from a phone, e.g.
// "Nazia.m4a.mp4") as video/mp4, which matched none of these and fell through
// to the document handler. ffprobe on the pipeline extracts the audio track.
const AUDIO_MIME_TOKENS = ['audio', 'm4a', 'mp3', 'mp4', 'mpeg', 'wav', 'ogg', 'webm', 'aac', 'opus'];

// bd-2134: some phones send the recording as application/octet-stream with an
// audio filename — accept by extension too (belt-and-suspenders with the MIME).
const AUDIO_FILE_EXTENSIONS = ['.mp4', '.m4a', '.mp3', '.wav', '.ogg', '.oga', '.aac', '.opus', '.webm', '.amr', '.3gp', '.mpeg', '.mpga'];

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
 * Does the filename end in a known audio (or audio-in-container) extension?
 * @param {string|undefined|null} filename
 * @returns {boolean}
 */
function hasAudioExtension(filename) {
  if (!filename || typeof filename !== 'string') return false;
  const lower = filename.toLowerCase();
  return AUDIO_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
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
 * @param {{ mimeType?: string, fileSize?: number, filename?: string }} doc
 * @returns {{ decision: string, sizeMB?: string }}
 */
function classifyAudioDocument({ mimeType, fileSize, filename } = {}) {
  // bd-2134: audio if EITHER the MIME or the filename extension says so (Meta
  // mislabels .mp4/.m4a recordings as video/mp4 or application/octet-stream).
  if (!isAudioMimeType(mimeType) && !hasAudioExtension(filename)) {
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
  hasAudioExtension,
  buildTooLargeMessage,
  WHISPER_MAX_BYTES,
  WHATSAPP_DOCUMENT_MAX_BYTES,
};
