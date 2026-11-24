'use strict';
/**
 * The tap on "Continue on WhatsApp" (`coach_app_wa:<kind>`, observe/coach-observe-continue.js), the reply button that
 * follows the app's button for a coach on the portal's HITL switches (app-redirect 2h). whatsapp-bot.js asks this for a
 * button_reply with the prefix, and nothing else requires this file (it requires app-redirect and the /observe handler,
 * so a require from either would close a load cycle).
 *
 *   A COACH      today's WhatsApp /observe at its first step (handleObserveCommand, as a typed /observe that the app
 *                link does not intercept). Nothing has to be armed: the button works whenever it is tapped.
 *   ANYONE ELSE  never the WhatsApp observe (the operator, 24 Nov: "Principal can only do it on the app"): the app's
 *                button again when their switches give one (redirectIfFlagged), else nothing. Still handled, so the
 *                tap never falls to "Unknown button".
 *
 * Every tap is one funnel row, app_funnel.wa_button_tap (ids only). NOTHING HERE THROWS.
 */

const { logToFile } = require('../../utils/logger');
const { isCoachRole } = require('../teacher-audience');
const { continueKindOf, tkOf } = require('./coach-observe-continue');
const { redirectIfFlagged } = require('../app-redirect.service');
const { handleObserveCommand } = require('../../handlers/observe-command.handler');

function funnelEvent(name, props) {
  try { logToFile(name, { event: name, ...props }); } catch (_) { /* logging never decides the answer */ }
}

/**
 * true = handled (the caller returns); false = not this button (the button chain goes on).
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
      await redirectIfFlagged(kind, { userId: user.id, from, language: ctx.language, reason: 'wa_button_not_coach' });
      return true;
    }
    funnelEvent('app_funnel.wa_button_tap', { journeyId: null, userId: user.id, feature: kind, audience: 'coach', ok: true });
    await handleObserveCommand(user, from, '/observe');
  } catch (err) {
    logToFile('❌ coach observe WhatsApp button: the tap could not be handled', { tk: tkOf(user.id), kind, error: err?.message }, 'error');
  }
  return true;
}

module.exports = { handleContinueButton };
