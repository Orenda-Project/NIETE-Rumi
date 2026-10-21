'use strict';
/**
 * An inbound message with no phone number.
 *
 * A WhatsApp user who has adopted a username writes to a business number they have not exchanged a message with in
 * the last 30 days (and who is not in its contact book): Meta then omits `messages[0].from` and `contacts[0].wa_id`,
 * and sets only the business-scoped user id (`from_user_id`, "<country>.<digits>"). Every account in this bot is keyed
 * by phone, so such a message cannot be matched to a row — not even one that exists for that person's number.
 *
 * Before this module the webhook ran on with `from` undefined: the lookup missed, the create tried a row with a null
 * phone (Postgres 23502), the catch logged "database unreachable" while the database was up, and every reply went out
 * with no `to` and was refused by Meta. The user got silence.
 *
 * Now the webhook stops here, with one log line naming the real state. With the app_settings switch
 * `whatsapp_bsuid_reply` ON (JSON true; absent or anything else = OFF), it also sends ONE reply addressed to the
 * business-scoped id, in both offered languages (the person's stored language is in the row we cannot find). That
 * reply opens Meta's 30-day window, so the next message carries the phone and is matched as usual.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');
const { cachedSwitch } = require('./settings/switch-cache');

const SWITCH_KEY = 'whatsapp_bsuid_reply';

const replySwitch = cachedSwitch({
  ttlMs: 30 * 1000,
  off: false,
  read: async () => {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', SWITCH_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    return (data || []).some((r) => r.value === true);
  },
  log: (err) => logToFile('⚠️ phoneless inbound: settings lookup failed — reply switch off', { error: err.message }),
});

/** The id's country prefix only ("KE.…"): enough to read a log, never the whole id. */
const maskUserId = (id) => (typeof id === 'string' && id.includes('.') ? `${id.split('.')[0]}.…` : null);

/**
 * What a failed getOrCreateUser actually means, for the log line. Only an error with no known code is an outage.
 * @param {Error|object} err
 * @returns {string}
 */
function describeLookupFailure(err) {
  const code = err && err.code;
  if (code === 'NO_PHONE') return 'no phone number in the webhook (username user: business-scoped id only) — no account can be matched';
  if (code === '23502') return 'user create refused: a not-null column was empty (no phone number?)';
  if (code === '23505') return 'user create refused: unique-key clash (the row exists but the lookup missed it)';
  return 'database unreachable, account state unknown';
}

/**
 * The webhook's door for a message without a phone.
 * @param {{ from?: string, fromUserId?: string|null, messageType?: string }} inbound
 * @param {{ WhatsAppService: { sendTextToUserId: Function } }} deps
 * @returns {Promise<boolean>} true when the message was phoneless and has been handled here (the caller stops)
 */
async function handlePhonelessInbound({ from, fromUserId, messageType } = {}, { WhatsAppService } = {}) {
  if (from) return false;
  const replyOn = Boolean(fromUserId) && await replySwitch.get();
  logToFile(`⚠️ Inbound with ${describeLookupFailure({ code: 'NO_PHONE' })}`, {
    userId: maskUserId(fromUserId), type: messageType || null, reply: replyOn ? 'sent_to_user_id' : 'none (switch off)',
  });
  if (replyOn) {
    const text = `${resolveUx('phonelessInboundRetry', { language: 'ur' })}\n\n`
      + `${resolveUx('phonelessInboundRetry', { language: 'en' })}`;
    await WhatsAppService.sendTextToUserId(fromUserId, text);
  }
  return true;
}

module.exports = { handlePhonelessInbound, describeLookupFailure, SWITCH_KEY, _resetCache: () => replySwitch.reset() };
