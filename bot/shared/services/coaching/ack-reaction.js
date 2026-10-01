'use strict';
/**
 * Acknowledge a teacher's tap or photo with a FREE reaction instead of a billed
 * text — and never silently drop the acknowledgement.
 *
 * From 1 Oct 2026 Meta bills every message the bot sends; a reaction on the
 * teacher's own message is not billed. Several coaching acks ("📸 Got your
 * classroom photo", "Send the next photo", the commit-card thanks, …) carried
 * nothing the teacher had not just done, so they become a reaction on
 * the message they sent.
 *
 * Two rules keep the signal:
 *   1. A reaction needs the inbound wamid. No wamid (a parked photo re-attached
 *      later, a test, an old caller) → the text goes out exactly as before.
 *   2. sendReaction is best-effort: the pacer may skip it, and it returns false
 *      rather than throwing. A reaction that did not go out → the text goes out.
 *
 * Load: one Graph call per ack, the same as before (a reaction instead of a text).
 */

const { logToFile } = require('../../utils/logger');

/**
 * @param {{ to: string, messageId?: string|null, emoji: string }} args
 * @returns {Promise<boolean>} true only when the reaction was accepted
 */
async function reactInstead({ to, messageId, emoji }) {
  if (!to || !messageId || !emoji) return false;
  try {
    const WhatsAppService = require('../whatsapp.service');
    return (await WhatsAppService.sendReaction(to, messageId, emoji)) === true;
  } catch (err) {
    logToFile('⚠️ ack reaction threw — falling back to the text', { error: err.message }, 'warn');
    return false;
  }
}

/**
 * React when we can; otherwise send the text the reaction replaces.
 *
 * @param {{ to: string, messageId?: string|null, emoji: string, text: string, what?: string }} args
 * @returns {Promise<'reaction'|'text'>} which signal went out
 */
async function reactOrSay({ to, messageId, emoji, text, what = 'ack' }) {
  if (await reactInstead({ to, messageId, emoji })) {
    logToFile('✅ ack sent as a reaction (no billed text)', { what, emoji });
    return 'reaction';
  }
  const WhatsAppService = require('../whatsapp.service');
  await WhatsAppService.sendMessage(to, text);
  logToFile('ℹ️ ack sent as text (no wamid or the reaction did not go out)', { what, hadWamid: !!messageId });
  return 'text';
}

module.exports = { reactInstead, reactOrSay };
