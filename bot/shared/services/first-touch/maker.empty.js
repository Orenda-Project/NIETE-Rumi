'use strict';
/**
 * The empty /quiz line → the quiz maker.
 *
 * A registered teacher whose /quiz list has no lesson today gets "No lessons yet…" (tqListEmptyPlans / tqListEmpty,
 * sent inside showList). With `quiz_maker_page` on, that ONE reply becomes the maker cta instead (maker.empty.body +
 * maker.empty.btn, a /m/ link whose token says via 'empty'), or, when the cta_url is refused, the 3-button fallback
 * with the known teacher's body. Same reply count (1).
 *
 * emptyLine() → true when it answered (showList then sends nothing); false = today's reply, sent by today's code:
 *   - the switch off (no event, nothing read but the switch);
 *   - the ledger refused `maker_reply` (over the per-phone cap, or the trigger not yet in its closed list): a known
 *     teacher is never left with no reply, so today's string goes out, unledgered, as today;
 *   - nothing went out (the cta and its fallback both failed).
 * Never throws. Emits onboard.quiz_door{ door:'empty', reply:'maker'|'fallback'|'today', ukey? } when the switch is on.
 */
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

/** The phone's event key: the sister's ukeyOf, as the door reads it; null when it cannot be made. */
function ukeyFor(phone) {
  try {
    const BindRepo = require('../quiz/child-phone-bindings.repo');
    return BindRepo.ukeyOf(BindRepo.normalisePhone(phone)) || null;
  } catch (_) {
    return null;
  }
}

/** Never throws: it runs after a send, and a throw here must not add today's reply to one already sent. */
function logDoor(phone, reply) {
  try {
    const ukey = ukeyFor(phone);
    logEvent('onboard.quiz_door', { door: 'empty', reply, ...(ukey ? { ukey } : {}), w: 's' });
  } catch (_) { /* the event is lost, the reply stands */ }
}

/**
 * Reads makerCta's answer. Expected shape { allowed, sent, fallback } (see the maker cta); a bare boolean is read as
 * "sent". → 'maker' | 'fallback' | 'today'.
 */
function replyOf(res) {
  if (res === true) return 'maker';
  if (!res || typeof res !== 'object' || res.allowed === false || res.capped) return 'today';
  if (!res.sent) return 'today';
  return res.fallback ? 'fallback' : 'maker';
}

async function emptyLine({ user, phone, lang } = {}) {
  try {
    if (!user || !user.id || !phone) return false;
    const flags = await require('../quiz/web-quiz-identity-flags').flags();
    if (!flags.makerPage) return false;
    const { makerCta } = require('./maker.cta');
    const res = await makerCta({
      uid: user.id, lang, who: 'known', via: 'empty', phone, body: 'maker.empty.body', button: 'maker.empty.btn',
    });
    const reply = replyOf(res);
    logDoor(phone, reply);
    return reply !== 'today';
  } catch (err) {
    logToFile('⚠️ first touch: the empty line\'s maker reply failed — today\'s reply', { error: err && err.message });
    return false;
  }
}

module.exports = { emptyLine, replyOf };
