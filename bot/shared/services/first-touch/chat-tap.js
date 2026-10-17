'use strict';
/**
 * The one way back to WhatsApp on a dead-end page (an expired, forged or failed link) while quiz_one_door is ON:
 *
 *   chatHref(bot)    → https://wa.me/<digits>?text=quiz when `bot` is a dialable number (cards.page botOf: 10–15
 *                      digits once everything else is stripped), else whatsapp://send?text=quiz (opens the installed
 *                      app with "quiz" typed, no number needed). Never empty.
 *   backText(lang)   → the signed sentence (one-door.strings go.back) in 'en', else Urdu ('ur' / 'bi').
 *   backTap(lang, bot) → { href, text } — the shape maker.page buildMessagePage takes as its `tap`.
 *
 * Callers decide the switch (one-door.flags on() in the bot, dashboard/lib/one-door-switch.js on the portal); with
 * it OFF nobody calls this and every page is today's. Pure: no read, no write, no message.
 */
const { str } = require('./one-door.strings');

const BACK_ID = 'go.back';
const WA_APP_HREF = 'whatsapp://send?text=quiz';

function chatHref(bot) {
  let n = null;
  try { n = require('./cards.page').botOf(bot); } catch (_) { n = null; }
  return n ? `https://wa.me/${n}?text=quiz` : WA_APP_HREF;
}

const backText = (lang) => str(BACK_ID, lang === 'en' ? 'en' : 'ur');

const backTap = (lang, bot) => ({ href: chatHref(bot), text: backText(lang) });

module.exports = { chatHref, backText, backTap, BACK_ID, WA_APP_HREF };
