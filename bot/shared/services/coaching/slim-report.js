/**
 * v10 coaching test (bd-v0toag.57): groups C and D get a slim report image.
 *
 * Their full report is on the /cr page, one tap away (report-link-send.js, .19), so the WhatsApp image keeps the
 * score band and the one thing to try. That thing is the .20 pick (thing-to-try-pick.js), the same text the next
 * plan's caption shows, else the commitment action. No link means no button, so the full image. A, B, an undrawn
 * school or the switch off: null, and the report renders as today. Never throws.
 */

const { logToFile } = require('../../utils/logger');
const { groupFor } = require('./ab-v10-arms');
const { reportLinkUrl } = require('./report-link-token');
const { pickThingToTry } = require('./thing-to-try-pick');

/** { tryNext } when this teacher gets the slim image, else null. */
async function slimReportFor({ userId, sessionId, lpFidelity, commitmentAction }) {
  try {
    const arms = await groupFor(userId);
    if (!arms || arms.report !== 'new') return null;
    if (!reportLinkUrl({ sessionId, userId })) return null;
    const pick = pickThingToTry(lpFidelity);
    return { tryNext: (pick && pick.text) || commitmentAction || '' };
  } catch (err) {
    logToFile('v10 test: slim report lookup failed (the full image is sent)', { userId, sessionId, error: err.message });
    return null;
  }
}

module.exports = { slimReportFor };
