/**
 * v10 coaching test (bd-v0toag.57): groups C and D get a slim report image.
 *
 * Their full report is on the /cr page, one tap away (report-link-send.js, .19), so the WhatsApp image is the
 * page's card (report-v2/slim-card.template.js, Amena's ICT-3 template). Its one thing to try is the .20 pick
 * (thing-to-try-pick.js), the same text the next plan's caption shows, with the step its move sits in; else the
 * commitment action, with no step. No link means no button, so the full image. A, B, an undrawn
 * school or the switch off: null, and the report renders as today. Never throws.
 */

const { logToFile } = require('../../utils/logger');
const { groupFor } = require('./ab-v10-arms');
const { reportLinkUrl } = require('./report-link-token');
const { pickThingToTry } = require('./thing-to-try-pick');
const { stepOf } = require('./report-card');

/** { tryNext, step, tag } when this teacher gets the slim image, else null. */
async function slimReportFor({ userId, sessionId, lpFidelity, commitmentAction }) {
  try {
    const arms = await groupFor(userId);
    if (!arms || arms.report !== 'new') return null;
    if (!reportLinkUrl({ sessionId, userId })) return null;
    const pick = pickThingToTry(lpFidelity);
    if (!pick) return { tryNext: commitmentAction || '', step: null, tag: null };
    const move = ((lpFidelity && lpFidelity.moves) || []).find((m) => m && pick.move_id && m.move_id === pick.move_id);
    return { tryNext: pick.text, step: move ? stepOf(move.phase) : null, tag: pick.tag || null };
  } catch (err) {
    logToFile('v10 test: slim report lookup failed (the full image is sent)', { userId, sessionId, error: err.message });
    return null;
  }
}

module.exports = { slimReportFor };
