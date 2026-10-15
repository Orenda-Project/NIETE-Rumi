/**
 * Audio-document router — classification helpers for handleDocumentMessage.
 *
 * Context: WhatsApp refuses an AUDIO attachment over 16 MB on the phone, before it reaches us, but
 * carries a DOCUMENT up to 100 MB. A lesson from a phone's voice recorder app (about 130 kbps) is
 * over 16 MB after about 17 minutes, so classroom recordings arrive here, as documents.
 *
 * classifyAudioDocument and buildTooLargeMessage are pure. resolveAudioDocument does one read (Meta's
 * media info), through the function its caller passes in; it does not log. Callers own logging and
 * side effects.
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
 *       — audio over the 100 MB cap; caller sends buildTooLargeMessage and does not download.
 *   { decision: 'route_to_audio_pipeline', sizeMB }
 *       — audio within the cap (or size unknown); caller downloads, probes the duration and routes.
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
 * Classify a document with its REAL size.
 *
 * Meta does not put `file_size` on an inbound document (none of the production webhooks carry it),
 * so a classification from the webhook alone never knows the size and the cap never fires.
 * The size is in Meta's media info (GET /{media-id} → file_size). This asks for it, only for an
 * audio document whose size the webhook left out, and classifies again with it.
 *
 * If the media info cannot be read, the webhook-only classification is returned, with
 * `sizeLookupError`: the file goes on to the download as before, and the caller logs why its size
 * was unknown. A refusal is only ever made from a size Meta gave.
 *
 * @param {{ mimeType?: string, fileSize?: number, filename?: string, mediaId?: string }} doc
 * @param {{ getMediaInfo?: (mediaId: string) => Promise<{ file_size?: number|string }> }} deps
 * @returns {Promise<{ decision: string, sizeMB?: string|null, sizeLookupError?: string }>}
 */
async function resolveAudioDocument(doc = {}, { getMediaInfo } = {}) {
  const first = classifyAudioDocument(doc);
  if (first.decision !== 'route_to_audio_pipeline' || first.sizeMB !== null) return first;
  if (!doc.mediaId || typeof getMediaInfo !== 'function') return first;
  let info;
  try {
    info = await getMediaInfo(doc.mediaId);
  } catch (err) {
    return { ...first, sizeLookupError: (err && err.message) || 'media info failed' };
  }
  const size = Number(info && info.file_size);
  if (!Number.isFinite(size) || size <= 0) return first;
  return classifyAudioDocument({ ...doc, fileSize: size });
}

/**
 * The reply to an audio document over the cap, in the sender's language (catalog key
 * audioDocumentTooLarge). It says what happened (nothing was received, nothing started) and what to
 * send instead.
 * @param {string} sizeMB e.g. "150.0"
 * @param {{ user?: object, language?: string }} [who] the sender, for the language
 * @returns {string}
 */
function buildTooLargeMessage(sizeMB, { user, language } = {}) {
  const { resolveUx } = require('../config/ux-strings');
  return resolveUx('audioDocumentTooLarge', { user, language, params: { size: sizeMB } });
}

module.exports = {
  classifyAudioDocument,
  resolveAudioDocument,
  isAudioMimeType,
  hasAudioExtension,
  buildTooLargeMessage,
  WHISPER_MAX_BYTES,
  WHATSAPP_DOCUMENT_MAX_BYTES,
};
