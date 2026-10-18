'use strict';
/**
 * The one way back to WhatsApp on a dead-end page (an expired, forged or failed link) while web_quiz_closed_way_back is ON:
 *
 *   chatHref(bot)    → https://wa.me/<digits>?text=quiz when `bot` is a dialable number (cards.page botOf: 10–15
 *                      digits once everything else is stripped), else whatsapp://send?text=quiz (opens the installed
 *                      app with "quiz" typed, no number needed). Never empty.
 *   backText(lang)   → the signed sentence (one-door.strings go.back) in 'en', else Urdu ('ur' / 'bi').
 *   backTap(lang, bot) → { href, text } — the shape maker.page buildMessagePage takes as its `tap`.
 *   linkLang(req)    → the LINK's own language for the page, before the phone's: ?lang=ur|en, else the link's token's own
 *                      `l` / `lang` (its payload read WITHOUT checking the signature — it decides a language and nothing
 *                      else; a language is not an identity), else null (the caller keeps today's choice).
 *
 * Callers decide the switch (closed-way-back.flags on() in the bot, dashboard/lib/closed-way-back-switch.js on the portal); with
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

const LANG = (v) => (v === 'ur' || v === 'en' ? v : null);
function linkLang(req) {
  const q = LANG(req && req.query ? req.query.lang : null);
  if (q) return q;
  const t = String((req && req.params && req.params.token) || '');
  const dot = t.indexOf('.');
  if (dot < 1 || dot > 1200) return null;
  try {
    const p = JSON.parse(Buffer.from(t.slice(0, dot), 'base64url').toString('utf8'));
    return (p && (LANG(p.l) || LANG(p.lang))) || null;
  } catch (_) { return null; }
}

module.exports = { chatHref, backText, backTap, linkLang, BACK_ID, WA_APP_HREF };
