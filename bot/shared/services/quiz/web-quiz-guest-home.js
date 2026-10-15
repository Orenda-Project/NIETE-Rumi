'use strict';
/**
 * The guest home: /quiz from a phone the door does not know, that is not a teacher's (web_quiz_guest_home, effective
 * only with web_quiz_phone_bind on). ONE reply with a link button to /h/<guest token>; the token carries only the
 * phone's tombstone (web-quiz-token signGuest), never the phone and never an id.
 *
 * Nothing is created here: no child row, no binding, no run. The guest's own child row is created when the guest
 * page's tapped answers arrive (grade_source 'tapped', bound with via 'guest', which emits bind_bound{via:'guest'});
 * that page is not built yet and the hub answers 404 for a guest token until it is.
 *
 * At most GUEST_REPLY_MAX replies per phone in GUEST_REPLY_WINDOW_SECS (keyed by the tombstone in Redis);
 * past it the caller's path is today's. Ledger trigger guest_reply.
 *
 * Copy: bot.guest.home (body) and bot.guest.home_btn (button) → UX_STRINGS guestHome / guestHomeBtn. Until they
 * exist copy() THROWS, offer() sends nothing and returns false, so no untranslated line can reach a family.
 *
 * offer() never throws: false = not offered (switch off, no salt, no copy, cap reached, send failed).
 */
const redisService = require('../cache/railway-redis.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx, UX_STRINGS } = require('../../config/ux-strings');
const IdFlags = require('./web-quiz-identity-flags');
const BindRepo = require('./child-phone-bindings.repo');
const T = require('./web-quiz-token');
const Ledger = require('./message-ledger');

const GUEST_REPLY_MAX = 2;
const GUEST_REPLY_WINDOW_SECS = 30 * 24 * 60 * 60;
const REPLIES_KEY = (tomb) => `wq_guest_replies:${tomb}`;
const COPY_KEYS = Object.freeze({ body: 'guestHome', button: 'guestHomeBtn' });

/** The reply's words; throws while the copy keys are missing (a copy gap must never become an untranslated send). */
function copy(language) {
  for (const key of Object.values(COPY_KEYS)) {
    if (!UX_STRINGS[key]) throw new Error(`copy gap: bot.guest.home (${key}) is not in ux-strings`);
  }
  // button ≤ 20 code points
  return { body: resolveUx(COPY_KEYS.body, { language }), buttonText: resolveUx(COPY_KEYS.button, { language }) };
}

async function offer(phone, language = 'en') {
  try {
    if (!(await IdFlags.flags()).guestHome) return false;
    const tomb = BindRepo.tombOf(phone);
    if (!tomb) { logToFile('⚠️ guest home: no tomb salt — not offered'); return false; }
    const words = copy(language);
    const replies = Number(await redisService.get(REPLIES_KEY(tomb))) || 0;
    if (replies >= GUEST_REPLY_MAX) { logEvent('student_quiz.opened', { how: 'guest_capped' }); return false; }
    const base = require('./web-quiz-link').webBaseUrl();
    const token = T.signGuest({ phoneTomb: tomb });
    if (!base || !token) return false;
    // Counted first, with the phone (the per-phone daily reply cap); over the cap the ledger says no and nothing is sent.
    if (!(await Ledger.record({ trigger: 'guest_reply', phone, reason: 'guest' }))) return true;
    const WhatsAppService = require('../whatsapp.service');
    const sent = await WhatsAppService.sendCtaUrl(phone, { ...words, url: `${base}/h/${token}` });
    if (!sent) { logToFile('⚠️ guest home: link send failed'); return false; }
    await redisService.set(REPLIES_KEY(tomb), replies + 1, GUEST_REPLY_WINDOW_SECS);
    logEvent('student_quiz.opened', { how: 'guest' });
    return true;
  } catch (err) {
    logToFile('⚠️ guest home: not offered', { error: err.message });
    return false;
  }
}

module.exports = { offer, copy, GUEST_REPLY_MAX, GUEST_REPLY_WINDOW_SECS, COPY_KEYS };
