'use strict';
/**
 * bd-r2uzg1.2 — a file she sent that WhatsApp could not hand us gets ONE reply a day.
 *
 * WHY. When a coach or teacher sends a recording, a lesson-plan photo or a PDF that WhatsApp cannot pass on, Meta
 * says so in a FAILED status receipt with error 131052 ("Media download error"), recipient_id = the SENDER. Its
 * error_data.details reads either "Incoming media file validation failed or the received media is in incorrect
 * format, please ask the sender to resend" or "Media file size too big 122MB. Max file size we currently support:
 * 100MB". The bot only logged it, so she waited for a reply that never came: 97 times in the 6 weeks to 12 Nov 2026
 * on production, 3-7 a week lately (ICT issues sheet: HITL 183, 185; DC 134).
 *
 * WHAT. One message, in her language: send it again as a Document; or, when the file was too big, that it is too
 * big (a Document over the limit fails the same way). At most one per sender per 24 hours — a coach who sends three
 * photos that all fail hears it once. Her 24h window is open (she has just written to us), so a free-form text lands.
 *
 * NEVER THROWS. It runs inside the status webhook; a lookup or a send that fails is logged and the webhook goes on.
 * Redis down → setNX answers "claimed" (it never drops work), so the worst case is a second reply that day.
 */

const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');
// A teacher's keyed reference for log lines, never the raw id (log-raw-ids gate).
const teacherRef = (id) => { try { return id ? require('./quiz/web-quiz-kid').tk(id) : null; } catch (_) { return null; } };

const MEDIA_DOWNLOAD_ERROR = 131052;
const ONCE_PER_SECONDS = 24 * 60 * 60;
const KEY_PREFIX = 'inbound_media_failed_notice:';

// bd-f3b562 (queue #233, 23 Nov 2026) — a coach in the MIDDLE of an observation, armed for a recording, hears it every
// time. On prod a coach armed for her debrief sent the recording 6 times in 3 hours; Meta refused each one (131052) and
// the once-a-day rule answered only the first, so the debrief looked stuck to her and to her lead. Her visit waits on
// exactly that file, so each refused send gets the step's own line. A short burst key still folds two files refused
// together (a double-send) into one reply. Any other sender keeps the once-a-day notice.
const OBSERVE_BURST_SECONDS = 2 * 60;
const OBSERVE_KEY_BY_STATE = {
  awaiting_debrief_audio: 'inboundMediaObserveDebrief',
  awaiting_audio: 'inboundMediaObserveLesson',
};

const digits = (phone) => String(phone || '').replace(/^\+/, '');
const last4 = (phone) => digits(phone).slice(-4);

/** Meta's own words say the file was over its size limit. */
function isTooBig(error) {
  const said = `${error?.error_data?.details || ''} ${error?.message || ''}`;
  return /too big|max file size/i.test(said);
}

const defaultDeps = {
  setNX: (key, value, ttl) => require('./cache/railway-redis.service').setNX(key, value, ttl),
  findUser: async (phone) => {
    const supabase = require('../config/supabase');
    const { data } = await supabase
      .from('users').select('id, preferred_language').eq('phone_number', phone).is('deleted_at', null).maybeSingle();
    return data || null;
  },
  send: (to, text) => require('./whatsapp.service').sendMessage(to, text),
  getObserveState: (userId) => require('./observe/observe-state.service').getState(userId),
};

/** The observe recording she is armed for ('inboundMediaObserve…'), or null. A failed lookup reads as none. */
async function observeKeyFor(user, deps) {
  if (!user || !user.id || typeof deps.getObserveState !== 'function') return null;
  try {
    const st = await deps.getObserveState(user.id);
    return (st && OBSERVE_KEY_BY_STATE[st.state]) || null;
  } catch (err) {
    logToFile('inbound_media_failed.observe_state_unknown', { tk: teacherRef(user.id), error: err && err.message }, 'warn');
    return null;
  }
}

/**
 * A failed status receipt from Meta. Acts only on 131052.
 * @returns {Promise<{sent: boolean, key?: string, reason?: string}>}
 */
async function onFailedStatus(status, deps = defaultDeps) {
  try {
    const error = status && status.errors && status.errors[0];
    if (!error || Number(error.code) !== MEDIA_DOWNLOAD_ERROR || !status.recipient_id) {
      return { sent: false, reason: 'not_131052' };
    }
    const phone = digits(status.recipient_id);
    const user = await deps.findUser(phone);
    const observeKey = await observeKeyFor(user, deps);
    if (observeKey) {
      const fresh = await deps.setNX(`${KEY_PREFIX}${phone}:observe`, '1', OBSERVE_BURST_SECONDS);
      if (!fresh) {
        logToFile('inbound_media_failed.told_just_now', { phone: last4(phone), tk: teacherRef(user.id) });
        return { sent: false, reason: 'told_just_now' };
      }
    } else {
      const claimed = await deps.setNX(KEY_PREFIX + phone, '1', ONCE_PER_SECONDS);
      if (!claimed) {
        logToFile('inbound_media_failed.already_told_today', { phone: last4(phone) });
        return { sent: false, reason: 'already_told_today' };
      }
    }
    const key = isTooBig(error) ? 'inboundMediaTooBig' : (observeKey || 'inboundMediaResend');
    // No account (or no stored choice): resolveUx falls to the catalog floor, English (clampLanguage).
    const text = resolveUx(key, { user: user || undefined });
    const ok = await deps.send(phone, text);
    logToFile(ok ? 'inbound_media_failed.notice_sent' : 'inbound_media_failed.notice_not_sent',
      { phone: last4(phone), tk: teacherRef(user && user.id), key }, ok ? 'info' : 'error');
    return { sent: !!ok, key };
  } catch (err) {
    logToFile('inbound_media_failed.error', { error: err && err.message }, 'error');
    return { sent: false, reason: 'error' };
  }
}

module.exports = {
  onFailedStatus, isTooBig, MEDIA_DOWNLOAD_ERROR, KEY_PREFIX, ONCE_PER_SECONDS, OBSERVE_BURST_SECONDS,
};
