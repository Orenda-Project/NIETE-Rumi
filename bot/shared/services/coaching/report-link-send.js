'use strict';
/**
 * v10 coaching test (bd-v0toag.19): groups C and D (the new report) get the link to their report page.
 *
 * Sent right after the report image: one link button (cta_url) that opens /cr/<token>
 * (report-link-token.js). The report goes out minutes after her recording, so it is always inside
 * WhatsApp's 24-hour window and no template is needed; if the button send fails, the same text
 * goes with the link written out. Voice note, commit buttons and quiz are unchanged (Amena, 14 Oct).
 *
 * A, B, a school not drawn, the switch off, or no link (PORTAL_URL or key missing): nothing is
 * sent, today's report unchanged. Never throws: a failed link never fails the report.
 */

const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { clampLanguage, resolveUx } = require('../../config/ux-strings');
const { groupFor } = require('./ab-v10-arms');

const PART = 'link';

/** true when the link went out (button or text). */
async function sendReportLinkIfNew({ coachingSessionId, userId, phone, language, track }) {
  let g;
  try {
    g = await groupFor(userId);
  } catch (_) {
    g = null;
  }
  if (!g || g.report !== 'new') return false;

  const url = require('./report-link-token').reportLinkUrl({ sessionId: coachingSessionId, userId });
  if (!url) {
    logToFile('v10 test: no report link (PORTAL_URL or key missing), report sent without it', { coachingSessionId });
    return false;
  }

  const lang = clampLanguage(language);
  const body = resolveUx('coachingReportLinkBody', { language: lang });
  let ok = false;
  let error = null;
  try {
    ok = (await WhatsAppService.sendCtaUrl(phone, {
      body,
      buttonText: resolveUx('coachingReportLinkButton', { language: lang }),
      url,
    }, track ? track.opts(PART) : {})) === true;
  } catch (err) {
    error = err;
  }
  if (!ok) {
    try {
      ok = (await WhatsAppService.sendMessage(phone, `${body}\n${url}`)) !== false;
    } catch (err) {
      error = err;
    }
  }
  if (track) {
    if (ok) await track.record(PART, true);
    else await track.record(PART, false, error || new Error('report link send failed'));
  }
  if (!ok) logToFile('v10 test: report link not sent (the report itself went out)', { coachingSessionId });
  return ok;
}

module.exports = { sendReportLinkIfNew };
