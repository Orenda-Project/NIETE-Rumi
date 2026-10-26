/**
 * v10 coaching test (bd-v0toag.57): groups C and D get a slim report image.
 *
 * Their full report is on the /cr page, one tap away (report-link-send.js, .19), so the WhatsApp image is the
 * page's card (report-v2/slim-card.template.js, Amena's ICT-3 template). Its one thing to try is the one
 * resolveThing settles for this recording (thing-to-try-pick.js: the live ask of this subject and grade, else a
 * new pick), the same text the next plan's caption shows, with its stored step; else the commitment action,
 * with no step. No link means no button, so the full image. A, B, an undrawn
 * school or the switch off: null, and the report renders as today. Never throws.
 */

const { logToFile } = require('../../utils/logger');
const { groupFor } = require('./ab-v10-arms');
const { reportLinkUrl } = require('./report-link-token');
const { resolveThing } = require('./thing-to-try-pick');

/** { tryNext, step, tag } when this teacher gets the slim image, else null. */
async function slimReportFor({ userId, sessionId, lpFidelity, commitmentAction }) {
  try {
    const arms = await groupFor(userId);
    if (!arms || arms.report !== 'new') return null;
    if (!reportLinkUrl({ sessionId, userId })) return null;
    const { thing } = await resolveThing({ userId, coachingSessionId: sessionId, lpFidelity });
    if (!thing || !thing.text) return { tryNext: commitmentAction || '', step: null, tag: null };
    return { tryNext: thing.text, step: thing.step || null, tag: thing.tag || null };
  } catch (err) {
    logToFile('v10 test: slim report lookup failed (the full image is sent)', { userId, sessionId, error: err.message });
    return null;
  }
}

module.exports = { slimReportFor };
