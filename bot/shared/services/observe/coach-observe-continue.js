'use strict';
/**
 * "Continue on WhatsApp" — the reply button that follows the app's button for a coach on the portal's HITL switches
 * (app-redirect 2h): its id, in one place for the sender and the answerer. The operator, 24 Nov: "when the coaches do
 * /observe, they should still [get] the portal link, but a button to still continue thru the whatsapp just in case
 * something breaks"; and "The WhatsApp fallback is just for the coaches. Principal can only do it on the app."
 *
 *   THE ID   `coach_app_wa:<kind>`; only 'observe' is sent. app-redirect builds it; the tap is answered by
 *            observe/coach-observe-continue-tap.js, which whatsapp-bot.js asks for a button_reply with the prefix.
 *
 * A LEAF: it requires nothing of the bot, so app-redirect can require it without a load cycle (the tap's handler
 * requires app-redirect and the /observe handler, so it lives in its own file that only the webhook requires).
 */

const CONTINUE_PREFIX = 'coach_app_wa:';
const KINDS = Object.freeze(['observe']);

/** The button id for a kind ('observe'). */
const continueButtonId = (kind) => `${CONTINUE_PREFIX}${kind}`;

/** The kind a button id names, or null when the id is not one of ours. */
function continueKindOf(buttonId) {
  const id = String(buttonId || '');
  if (!id.startsWith(CONTINUE_PREFIX)) return null;
  const kind = id.slice(CONTINUE_PREFIX.length);
  return KINDS.includes(kind) ? kind : null;
}

/** A person's keyed reference for a diagnostic log line (quiz/web-quiz-kid tk), never the raw users.id; null without a key. */
function tkOf(userId) {
  try { return require('../quiz/web-quiz-kid').tk(userId); } catch (_) { return null; }
}

module.exports = { CONTINUE_PREFIX, continueButtonId, continueKindOf, tkOf };
