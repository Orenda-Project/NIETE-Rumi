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

// Meta's cap on an interactive message body, in CODE POINTS (language-protocol §3).
const FLOW_BODY_CAP = 1024;

/**
 * @param {object} args
 * @param {string} args.from      WhatsApp number to send to
 * @param {string} args.userId    users.id — leads the flow token so the endpoint can resolve her
 * @param {string} [args.language] 'en' | 'ur' (anything else falls back to English)
 * @param {string} [args.reason]  which door — for the log line only. Callers pass
 *   'menu', 'bare_command', 'voice_lesson_plan_intent' or 'ice_breaker' (a tapped
 *   conversational-components chip on a first open). It changes nothing about what
 *   is sent — one door, one copy — but it is the only way the funnel can tell a
 *   cold first-open apart from a menu tap, and it is cheaper than a second method.
 * @param {string} [args.bodyPrefix] OPTIONAL paragraph set above the usual body, in the caller's
 *   already-resolved language (Meta bill cut NL3). The topic-bearing doors pass the
 *   `lp612RouteRedirect` line here instead of sending it as its own billed text a second before
 *   the Flow — same words, one message. Every other door omits it and gets today's body. If the
 *   merged body would break Meta's 1024-code-point cap the line is sent on its own first, exactly
 *   as before, rather than risk a rejected Flow.
 * @returns {Promise<boolean>}
 */
async function openLpBrowseFlow({ from, userId, language, reason = 'unspecified', bodyPrefix = null }) {
  // bd-onxyu — the app-redirect switch. TRUE when it handled the request, because
  // every caller treats false as "fall back to another lesson-plan path".
  const { redirectIfFlagged } = require('./app-redirect.service');
  if (await redirectIfFlagged('lesson_plan', { userId, from, language, reason })) return true;

  const flowId = process.env.PAKISTAN_LP_FLOW_ID || '';
  if (!flowId) {
    logToFile('LP browse: no PAKISTAN_LP_FLOW_ID provisioned, caller falls back', { userId, reason });
    return false;
  }
  try {
    const plainBody = resolveUx('lpBrowseBody', { language });
    let body = plainBody;
    if (bodyPrefix) {
      const merged = `${bodyPrefix}\n\n${plainBody}`;
      if ([...merged].length <= FLOW_BODY_CAP) {
        body = merged;
      } else {
        // Over the cap → today's two-message shape. The line failing is a worse message, not none.
        logToFile('LP browse: prefix would exceed the Flow body cap — sent as its own line', {
          userId, reason, mergedCodePoints: [...merged].length,
        });
        try {
          await WhatsAppService.sendMessage(from, bodyPrefix);
        } catch (lineErr) {
          logToFile('LP browse: prefix line failed to send (non-fatal)', { userId, reason, error: lineErr.message });
        }
      }
    }
    const sent = await WhatsAppService.sendFlow(from, {
      flowId,
      header: resolveUx('lpBrowseHeader', { language }),
      body,
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
