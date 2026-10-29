'use strict';
/**
 * bd-v0toag.106 — a coaching report outside the teacher's 24 h WhatsApp window.
 *
 * The hero report is a free-form image. Past Meta's 24 h window Meta accepts the send and then refuses it with
 * 131047 in an asynchronous status receipt: the bot logs `coaching.report.sent` and she gets nothing.
 *
 * When her window is closed the report goes as the approved share template instead (share-send.service, kind 'dc':
 * share_dc_report_v1, IMAGE header = the report stored in R2, no 24 h limit). The voice debrief and the survey are
 * free-form and would be refused too, so the caller skips them on that path (followUpsAllowed).
 *
 * Anything that stops the template — window open, no user id, template not configured / refused / report not found,
 * a throw — returns null and the caller sends exactly as it always did.
 */

const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

function defaultDeps() {
  return {
    windowOpen: (phone) => require('../quiz/quiz-delivery.service')._hasOpenMessageWindow(phone),
    sendShare: (req) => require('../share-send.service').sendShare(req),
  };
}

/** @returns {Promise<'template'|null>} 'template' when the report went as the share template. */
async function sendReportByTemplateIfWindowClosed({ phone, userId, sessionId }, deps) {
  if (!phone || !userId || !sessionId) return null;
  const d = deps || defaultDeps();
  try {
    if (await d.windowOpen(phone)) return null;
    const out = await d.sendShare({ userId, kind: 'dc', id: sessionId });
    const sent = !!out && out.status === 'sent';
    try {
      logEvent(sent ? 'coaching.report.template_sent' : 'coaching.report.template_not_sent',
        { userId, sessionId, status: (out && out.status) || null, reason: (out && out.reason) || null,
          code: (out && out.code) || null, message: (out && out.message) || null }); // Meta's refusal, bd-v0toag.127
    } catch (_) { /* logging never decides */ }
    return sent ? 'template' : null;
  } catch (err) {
    logToFile('⚠️ Report window check / template send failed — sending as before', { sessionId, error: err && err.message }, 'warn');
    return null;
  }
}

/** The voice debrief and survey are free-form: they go unless the report itself had to go as a template. */
function followUpsAllowed(heroSent) {
  return heroSent !== 'template';
}

module.exports = { sendReportByTemplateIfWindowClosed, followUpsAllowed };
