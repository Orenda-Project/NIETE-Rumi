'use strict';
/**
 * The one door into the v8 lesson-plan catalogue.
 *
 * Every path that means "she wants a lesson plan" ends here — the bare
 * "lp" / "lesson plan" command, the LLM's lesson_plan intent (text and voice),
 * the /menu tap, and the Oxbridge picker's fallback button. They used to fan
 * out to three different endings: this Flow, a Gamma generation, and (after
 * bd-2540) a "not in our catalogue" reply. Production ran ~200 generations a
 * day (bd-jnfbd), so the day the not-in-catalogue reply reached main, those
 * teachers would have got nothing. Once generation is retired the catalogue
 * IS the answer, and one function owns the copy so the doors cannot drift
 * apart again (the bd-72dth lesson).
 *
 * Returns true when the Flow was sent. False means "no Flow provisioned, or
 * the send failed" — the caller decides what the fallback says.
 */

const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');

// The copy lives in the catalogue (ux-strings.js: lpBrowseHeader / Body /
// Button) — one reviewed string per offered language, capped there, resolved
// through the one language clamp. No inline map here, by doctrine.
const { resolveUx } = require('../config/ux-strings');

/**
 * @param {object} args
 * @param {string} args.from      WhatsApp number to send to
 * @param {string} args.userId    users.id — leads the flow token so the endpoint can resolve her
 * @param {string} [args.language] 'en' | 'ur' (anything else falls back to English)
 * @param {string} [args.reason]  which door — for the log line only
 * @returns {Promise<boolean>}
 */
async function openLpBrowseFlow({ from, userId, language, reason = 'unspecified' }) {
  const flowId = process.env.PAKISTAN_LP_FLOW_ID || '';
  if (!flowId) {
    logToFile('LP browse: no PAKISTAN_LP_FLOW_ID provisioned, caller falls back', { userId, reason });
    return false;
  }
  try {
    const sent = await WhatsAppService.sendFlow(from, {
      flowId,
      header: resolveUx('lpBrowseHeader', { language }),
      body: resolveUx('lpBrowseBody', { language }),
      buttonText: resolveUx('lpBrowseButton', { language }),
      flowToken: `${userId}:pakistan-lp:${Date.now()}`,
    });
    if (sent) {
      logToFile('📘 LP browse Flow opened', { userId, reason });
      return true;
    }
    logToFile('LP browse: Flow send returned false, caller falls back', { userId, reason });
    return false;
  } catch (err) {
    logToFile('LP browse: Flow send threw, caller falls back', { userId, reason, error: err.message });
    return false;
  }
}

module.exports = { openLpBrowseFlow };
