'use strict';
/**
 * One button system on the child pages (app_settings web_quiz_one_button, default off, fail off, 30 s cache).
 *
 * On: the quiz, hub, challenge menu and library answers carry `one_button: true`, and the page puts ONE class,
 * `wq-1b`, on <html> (wq-tel.js, the script every page loads first). Under it, wq.css draws every Home, back, share and
 * main button from one set of tokens (size, radius, shadow, press), centres every label, keeps every box 16 px off
 * both screen edges in either direction, and the home's grown-ups button says it is held, with a ring that fills.
 * Off: the key is absent, so every answer and every page is today's, byte for byte. Only the stored JSON boolean true
 * turns it on: the string 'true', 1, {enabled:true}, no row or a failed read are all off.
 *
 * The key rides the hub's one settings read (web-quiz-hub-flags.js), so the switch adds no read of its own to a
 * child's page. on() never waits: it answers from that cache and refreshes it in the background. The first answer
 * after a start is off; a value older than twice the cache time is off too.
 */
const Flags = require('./web-quiz-hub-flags');

const KEY = Flags.ONE_BUTTON_KEY;
const FIELD = 'one_button';

/** The switch, never waited for. Never throws. */
function on(now = Date.now()) {
  try { return Flags.oneButtonNow(now); } catch (_) { return false; }
}

/**
 * web_quiz_look_after on: the switch looked at again once the answer lands (the hub's own read has filled the cache by
 * then), so a cold or stale cache does not drop the field from the first answer after idle. Off: false (the look before only).
 */
function late() {
  try { return Flags.nowOf('lookAfter') && on(); } catch (_) { return false; }
}

/** The switch, waited for (tests). */
async function flag(now = Date.now()) {
  try { return Boolean((await Flags.flags(now)).oneButton); } catch (_) { return false; }
}

/**
 * A page answer with the switch's field: `one_button: true` only when on, nothing added when off. The switch is looked
 * at when this is called (before the answer is awaited), so its background refresh starts beside the page's own reads.
 */
function carry(answerP) {
  const one = on();
  return Promise.resolve(answerP).then((out) => ((one || late()) && out && typeof out === 'object' && !Array.isArray(out) ? Object.assign(out, { [FIELD]: true }) : out));
}

module.exports = { on, late, flag, carry, KEY, FIELD };
