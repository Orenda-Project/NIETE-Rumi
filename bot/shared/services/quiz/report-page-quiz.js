'use strict';
/**
 * "Make a quiz" on the coaching report PAGE, for a teacher whose 24 h WhatsApp window was closed.
 *
 * WHY. With the window closed the transcript quiz offer cannot go (Meta refuses a free-form message, 131047), so
 * closed-window-offer.js writes the session's quiz row as held (status 'skipped', meta.skip_reason 'window_closed').
 * The report itself still reaches her as one UTILITY template, and its "Open my report" button opens the /cr page
 * (coaching/report-link-button.js). That page is where the offer goes: no second message, no marketing template.
 *
 * HOW. The page shows "Make a quiz" = https://wa.me/<bot>?text=<prefill>, the prefill ending in a short code naming
 * the session (`CR-` + the session id's first 8 hex digits). Sending it is HER message, so it opens her window; the
 * bot matches the code to her own session (the sender's sessions only, one match or none) and treats it exactly as
 * the "Make a quiz" tap (transcript-quiz-offer.service handleReportQuizTap: owner check, then the quiz, free-form
 * inside the window it just opened).
 *
 * THE SWITCH. `app_settings.quiz_offer_closed_window`, the same row as the trace, part `"report_page": true`. Absent,
 * false, or unreadable = off: the page carries no block and the bot never matches a code.
 *
 * The portal requires this file for its page half (parseSwitch, pageQuiz), so it loads nothing of the bot's at module
 * scope (the portal has no pino). The bot half requires its modules when it runs.
 */

const SETTING = 'quiz_offer_closed_window';
const HELD_REASON = 'window_closed';
const REF_PREFIX = 'CR-';
const REF_RX = /\bCR-([0-9a-f]{8})\b/i;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** report_page from the row's value. Pure; anything unexpected is off. */
function parseSwitch(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return false; }
  }
  return !!v && typeof v === 'object' && !Array.isArray(v) && v.report_page === true;
}

/** One read through the given client. Throws on a failed read (the caller decides: off). */
async function fetchFrom(db) {
  const { data, error } = await db.from('app_settings').select('key,value').eq('key', SETTING);
  if (error) throw new Error(error.message || 'app_settings read failed');
  const row = (data || [])[0];
  return parseSwitch(row ? row.value : undefined);
}

/** `CR-a1b2c3d4` for a session id, or null. */
function refOf(sessionId) {
  const id = String(sessionId || '');
  return UUID_RX.test(id) ? `${REF_PREFIX}${id.slice(0, 8).toLowerCase()}` : null;
}

/** The 8 hex digits a message's code names, or null. */
function matchRef(text) {
  const m = REF_RX.exec(String(text || ''));
  return m ? m[1].toLowerCase() : null;
}

/**
 * The page's "Make a quiz" link for this session, or null: the switch off, the offer not held for a closed window
 * (no row, or a row that went on), no bot number. `db` is the portal's client. Never throws.
 */
async function pageQuiz({ db, sessionId, language, bot, switchOn }) {
  try {
    const ref = refOf(sessionId);
    if (!ref || !bot || !(await switchOn())) return null;
    const { data, error } = await db.from('quizzes').select('status, meta')
      .eq('coaching_session_id', sessionId).eq('quiz_source', 'transcript').maybeSingle();
    if (error || !data || data.status !== 'skipped' || !data.meta || data.meta.skip_reason !== HELD_REASON) return null;
    const { resolveUx } = require('../../config/ux-strings'); // eslint-disable-line global-require
    const text = resolveUx('qfix_offers_cr_quiz_prefill', { language, params: { ref } });
    return { ref, href: `https://wa.me/${bot}?text=${encodeURIComponent(text)}` };
  } catch (_) {
    return null;
  }
}

let botSwitch = null;
function botSwitchOn(now = Date.now()) {
  if (!botSwitch) {
    const { cachedSwitch } = require('../settings/switch-cache'); // eslint-disable-line global-require
    botSwitch = cachedSwitch({ ttlMs: 30 * 1000, off: false, read: () => fetchFrom(require('../../config/supabase')) }); // eslint-disable-line global-require
  }
  return botSwitch.get(now);
}

/**
 * The session a code names among the sender's own sessions: exactly one match, else null. The code is the first 8
 * hex digits of the id, so the range below is that prefix's whole slice of uuids (the primary key's index).
 */
async function sessionForRef({ ref, phone }, db) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!ref || !digits) return null;
  const { data: user } = await db.from('users').select('id').eq('phone_number', digits).maybeSingle();
  if (!user || !user.id) return null;
  const { data: rows } = await db.from('coaching_sessions').select('id').eq('user_id', user.id)
    .gte('id', `${ref}-0000-0000-0000-000000000000`).lte('id', `${ref}-ffff-ffff-ffff-ffffffffffff`).limit(2);
  return rows && rows.length === 1 ? rows[0].id : null;
}

/**
 * A text message carrying a report-page code. true when it was ours (handled, whatever the outcome); false when the
 * message has no code or the switch is off, so the text handler runs as before.
 */
async function handleReportPageText(text, phone, deps = {}) {
  const ref = matchRef(text);
  if (!ref) return false;
  const d = {
    switchOn: botSwitchOn,
    db: () => require('../../config/supabase'), // eslint-disable-line global-require
    tap: (payload, from) => require('./transcript-quiz-offer.service').handleReportQuizTap(payload, from), // eslint-disable-line global-require
    say: async (to) => {
      const Offer = require('./transcript-quiz-offer.service'); // eslint-disable-line global-require
      const { resolveUx } = require('../../config/ux-strings'); // eslint-disable-line global-require
      await require('../whatsapp.service').sendMessage(to, resolveUx('tqOfferExpired', { language: await Offer.languageByPhone(to) })); // eslint-disable-line global-require
    },
    log: (event, props) => require('../../utils/structured-logger').logEvent(event, props), // eslint-disable-line global-require
    ...deps,
  };
  if (!(await d.switchOn())) return false;
  let sessionId = null;
  try {
    sessionId = await sessionForRef({ ref, phone }, d.db());
  } catch (_) {
    sessionId = null;
  }
  try { d.log('transcript_quiz.report_page_text', { ref, outcome: sessionId ? 'matched' : 'no_session' }); } catch (_) { /* never decides */ }
  // No session of hers: she still hears something true, the /quiz door.
  if (!sessionId) await d.say(phone);
  else await d.tap(`tqr_${sessionId}`, phone);
  return true;
}

function _resetCache() { if (botSwitch) botSwitch.reset(); }

module.exports = {
  SETTING, parseSwitch, fetchFrom, refOf, matchRef, pageQuiz, sessionForRef, handleReportPageText, _resetCache,
};
