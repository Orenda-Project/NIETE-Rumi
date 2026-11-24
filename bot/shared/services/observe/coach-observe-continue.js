'use strict';
/**
 * "Continue on WhatsApp" — the reply button that follows the app's button for a coach on the portal's HITL switches
 * (app-redirect 2h). The operator, 24 Nov: "when the coaches do /observe, they should still [get] the portal link, but a
 * button to still continue thru the whatsapp just in case something breaks"; and "The WhatsApp fallback is just for the
 * coaches. Principal can only do it on the app."
 *
 *   THE ID     `coach_app_wa:<kind>`; only 'observe' is sent. One definition for the sender (app-redirect) and the
 *              answerer (handleContinueButton below, which whatsapp-bot.js asks for a button_reply with the prefix).
 *   A COACH    today's WhatsApp /observe at its first step (handleObserveCommand, as a typed /observe that the app link
 *              does not intercept). Nothing has to be armed: the button works whenever it is tapped.
 *   ANYONE ELSE  never the WhatsApp observe: the app's button again when their switches give one (redirectIfFlagged),
 *              else nothing. Still handled, so the tap never falls to "Unknown button".
 *
 * Leaf-ish on purpose: it needs neither the coach app nudge nor its offer state, so it runs on a branch that has
 * neither. The handlers it calls are required at call time (app-redirect requires this file for the id).
 * Every tap is one funnel row, app_funnel.wa_button_tap (ids only). NOTHING HERE THROWS.
 */

const { logToFile } = require('../../utils/logger');
const { isCoachRole } = require('../teacher-audience');

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

function funnelEvent(name, props) {
  try { logToFile(name, { event: name, ...props }); } catch (_) { /* logging never decides the answer */ }
}

/**
 * The tap. true = handled (the caller returns); false = not this button (the button chain goes on).
 *
 * @param {object} user      users row (id, role, preferred_language)
 * @param {string} from      WhatsApp number
 * @param {string} buttonId  the tapped button's id
 * @param {{ language?: string }} [ctx]
 * @returns {Promise<boolean>}
 */
async function handleContinueButton(user, from, buttonId, ctx = {}) {
  const kind = continueKindOf(buttonId);
  if (!kind || !user || !user.id || !from) return false;
  try {
    if (!isCoachRole(user.role)) {
      funnelEvent('app_funnel.wa_button_tap', { journeyId: null, userId: user.id, feature: kind, ok: false, why: 'not_a_coach' });
      const { redirectIfFlagged } = require('../app-redirect.service');
      await redirectIfFlagged(kind, { userId: user.id, from, language: ctx.language, reason: 'wa_button_not_coach' });
      return true;
    }
    funnelEvent('app_funnel.wa_button_tap', { journeyId: null, userId: user.id, feature: kind, audience: 'coach', ok: true });
    const { handleObserveCommand } = require('../../handlers/observe-command.handler');
    await handleObserveCommand(user, from, '/observe');
  } catch (err) {
    logToFile('❌ coach observe WhatsApp button: the tap could not be handled', { tk: tkOf(user.id), kind, error: err?.message }, 'error');
  }
  return true;
}

module.exports = { CONTINUE_PREFIX, continueButtonId, continueKindOf, tkOf, handleContinueButton };
