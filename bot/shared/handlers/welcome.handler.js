'use strict';
/**
 * bd-oak77.13 — the `request_welcome` door.
 *
 * With `enable_welcome_message: true` in the conversational-components manifest,
 * Meta posts a message of `type: "request_welcome"` the moment a teacher opens a
 * brand-new chat with the number — before she has typed anything. It has a `from`
 * and an id and nothing else: no `text`, no `interactive`.
 *
 * No repo in this workspace had a branch for it. It fell through
 * `whatsapp-bot.js` to `unsupportedTypeReply()`, so on the staging number — where
 * the flag has been true — a brand-new teacher's FIRST EVER message from the bot
 * was «میں صرف متن اور آواز کے پیغامات کا جواب دے سکتی ہوں۔ / I can only reply to
 * text and voice messages.» Rule 24(d): the copy has to name the actual state,
 * and the actual state here is "hello".
 *
 * The reply is deliberately ONE short bilingual body and no buttons: the four
 * ice-breaker chips are already on screen underneath it (that is the whole point
 * of the manifest), so a second list of options would be the same menu twice.
 *
 * Language: unknowable here by construction. She has no `preferred_language`, no
 * registration, and has sent no text to detect from — this event IS her first
 * contact. So both offered languages ride in one body (Urdu first, matching the
 * other bilingual first-contact strings in this deployment), and the language
 * question is answered later by /language or by registration.
 */

const WhatsAppService = require('../services/whatsapp.service');
const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');

/**
 * Answer a first-open, if that is what this is.
 *
 * Shaped as a predicate so the whole decision — including "is this the welcome
 * event" — is one testable unit and the call site in `whatsapp-bot.js` is a
 * single line that cannot drift.
 *
 * @param {string} messageType  the webhook `message.type`
 * @param {object} args
 * @param {string} args.from    WhatsApp number that opened the chat
 * @returns {Promise<boolean>}  true when this event was ours and is answered
 */
async function maybeHandleRequestWelcome(messageType, { from } = {}) {
  if (String(messageType || '') !== 'request_welcome') return false;

  logToFile('👋 request_welcome — first open, sending the bilingual welcome', { from });
  try {
    await WhatsAppService.sendMessage(from, resolveUx('welcomeFirstOpen'));
  } catch (err) {
    // Never throw out of the webhook path. A failed welcome costs her the
    // greeting; the ice-breaker chips are rendered by WhatsApp either way.
    // Third positional arg IS the level (tests/setup/logger-level-consistency).
    logToFile('❌ request_welcome send failed', { from, error: err.message }, 'error');
  }
  return true;
}

module.exports = { maybeHandleRequestWelcome };
