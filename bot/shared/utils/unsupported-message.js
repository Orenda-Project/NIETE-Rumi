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

/**
 * bd-1hae7 — the same failure, in call clothing. On the first real voice call
 * (staging, 2026-08-24) the teacher hung up and immediately received "I can only
 * reply to text and voice messages". WhatsApp posts an INTERACTIVE message of
 * type `call_permission_reply` around a call; it has no handler, so it fell
 * through to the generic fallback. Like a reaction, it is not a request —
 * answering it is noise, and right after a call it reads as the bot breaking.
 */
const SILENT_INTERACTIVE_TYPES = new Set([
  'call_permission_reply',
  'call_permission_request',
]);

/**
 * @param {string} messageType        the webhook `message.type`
 * @param {string} [interactiveType]  `message.interactive.type`, when applicable
 * @returns {string|null} reply text, or null for "stay silent"
 */
function unsupportedTypeReply(messageType, interactiveType) {
  const t = String(messageType || '').toLowerCase();
  if (SILENT_TYPES.has(t)) return null;
  if (t === 'video') return VIDEO_REPLY;
  if (t === 'interactive' && SILENT_INTERACTIVE_TYPES.has(String(interactiveType || '').toLowerCase())) {
    return null;
  }
  return DEFAULT_REPLY;
}

module.exports = {
  unsupportedTypeReply, SILENT_TYPES, SILENT_INTERACTIVE_TYPES, VIDEO_REPLY, DEFAULT_REPLY,
};
