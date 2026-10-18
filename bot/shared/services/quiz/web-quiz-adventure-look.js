'use strict';
/**
 * The adventure look on the child pages (app_settings web_quiz_adventure_look, default off, fail off, 30 s cache).
 *
 * On: the quiz, hub and challenge menu answers carry `adv: true`, and the edge puts ONE class on <html> (`wq-adv`) and
 * links the look's stylesheet and kit (wq-adventure.css, wq-adv.js) after the page's own. Off: the key is absent, so
 * every answer and every page is today's, byte for byte. Only the stored JSON boolean true turns it on: the string
 * 'true', '"true"', 'yes', 1, {enabled:true}, no row or a failed read are all off.
 *
 * The key rides the hub switches' one app_settings read (web-quiz-hub-flags.js, as web_quiz_one_button does), so the
 * look adds no read of its own. on() never waits: the cached answer, refreshed in the background when stale; off when
 * cold, and off once the value is older than twice the cache time (a refresh that never comes back).
 */
const Flags = require('./web-quiz-hub-flags');
// The look only re-colours the one button system's buttons, so it is on only when that switch is on too.
const OneButton = require('./web-quiz-one-button');

const KEY = Flags.ADV_KEY;
const FIELD = 'adv';

/** The switch, never waited for. Never throws. */
function on(now = Date.now()) {
  try { return Flags.advNow(now); } catch (_) { return false; }
}

/** The switch, waited for (tests). */
async function flag(now = Date.now()) {
  try { return Boolean((await Flags.flags(now)).adv); } catch (_) { return false; }
}

/**
 * A page answer with the switch's field: `adv: true` only when on AND the one button system is on, nothing added
 * otherwise. The switches are looked at when this is called (before the answer is awaited), so a background refresh
 * starts beside the page's own reads.
 */
function carry(answerP) {
  const one = OneButton.on() && on();
  // web_quiz_look_after on: looked at again once the answer lands (as OneButton.late()); off, the look before only
  return Promise.resolve(answerP).then((out) => ((one || (OneButton.late() && on())) && out && typeof out === 'object' && !Array.isArray(out) ? Object.assign(out, { [FIELD]: true }) : out));
}

module.exports = { on, flag, carry, KEY, FIELD };
