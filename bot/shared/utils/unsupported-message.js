'use strict';
/**
 * bd-fbih0 — what to reply when a message type has no handler.
 *
 * Live 2026-08-21 (coach mid-/observe, ~10:11 PKT): sending a VIDEO among
 * classroom photos got the generic "I can only respond to text and voice"
 * reply — mid-flow, it reads as the bot breaking. Worse, REACTING 👍 to any
 * message triggered the same error text (38 times that morning).
 *
 * Contract:
 *   - reaction / sticker / ephemeral system types → null (NEVER reply; a
 *     reaction is not a request, answering it is noise at best).
 *   - video → an explanatory line that names the supported inputs, so a coach
 *     mid-photo-capture knows to send photos, not that the bot "errored".
 *   - everything else → the historical generic fallback, unchanged.
 */

const SILENT_TYPES = new Set(['reaction', 'sticker', 'system', 'ephemeral', 'unsupported']);

const VIDEO_REPLY =
  'میں ویڈیو نہیں لے سکتی — تصاویر، آواز یا متن بھیجیں۔\n' +
  "I can't take videos — please send photos, voice notes, or text.";

// bd-z5olm: the historical fallback spoke as a MALE («سکتا ہوں») and
// Urdu-only. Rumi is female, and NIETE serves en/ur — bilingual like
// VIDEO_REPLY above.
const DEFAULT_REPLY =
  'میں صرف متن اور آواز کے پیغامات کا جواب دے سکتی ہوں۔\n' +
  'I can only reply to text and voice messages.';

/** @returns {string|null} reply text, or null for "stay silent" */
function unsupportedTypeReply(messageType) {
  const t = String(messageType || '').toLowerCase();
  if (SILENT_TYPES.has(t)) return null;
  if (t === 'video') return VIDEO_REPLY;
  return DEFAULT_REPLY;
}

module.exports = { unsupportedTypeReply, SILENT_TYPES, VIDEO_REPLY, DEFAULT_REPLY };
