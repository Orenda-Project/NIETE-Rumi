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
 *
 * bd-22gf7p (COS 20261031T144349 §2) — `clip` = { template, token, promised, imageStrip, useFallbackImage } from
 * video-reco/clip-button.js, present only when VIDEO_RECO_CLIP_TEMPLATE is set and the session's row is 'shown':
 *   - window closed → the clip template first (same header + body, a "Watch the clip" URL button = the /v token). Sent →
 *     the row's sent_via = 'template_button' (store.markSent; report_via stays 'template'). Refused → share_dc_report_v1
 *     exactly as today.
 *   - `promised` = the image's strip says "tap the button under this picture" (strip.js 'button'): the window is not
 *     consulted (it was closed at the render), so that image never goes free-form under a caption that has no button.
 *     If the button template is refused, `useFallbackImage()` first stores the hero's app-hint copy (the image the plain
 *     template's header reads), so the hint stays true on every fallback.
 * No clip → exactly the send above.
 */

const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

function defaultDeps() {
  return {
    windowOpen: (phone) => require('../quiz/quiz-delivery.service')._hasOpenMessageWindow(phone),
    sendShare: (req) => require('../share-send.service').sendShare(req),
    markSent: (id, v) => require('./video-reco/store').markSent(id, v),
  };
}

function logOutcome(name, { userId, sessionId }, out) {
  try {
    logEvent(name, { userId, sessionId, status: (out && out.status) || null, reason: (out && out.reason) || null,
      code: (out && out.code) || null, message: (out && out.message) || null }); // Meta's refusal, bd-v0toag.127
  } catch (_) { /* logging never decides */ }
}

/** The clip template, then (refused) the app-hint image put back in place. True when the button went. */
async function sendClipTemplate({ userId, sessionId, clip }, d) {
  let out = null;
  try {
    out = await d.sendShare({ userId, kind: 'dc', id: sessionId, clip: { template: clip.template, token: clip.token } });
  } catch (err) {
    out = { status: 'failed', reason: 'error', message: err && err.message };
  }
  if (out && out.status === 'sent') {
    logOutcome('coaching.report.clip_template_sent', { userId, sessionId }, out);
    try {
      await d.markSent(sessionId, { sent_via: 'template_button', wamid: null, image_strip: !!clip.imageStrip });
    } catch (_) { /* the marker never decides */ }
    return true;
  }
  logOutcome('coaching.report.clip_template_not_sent', { userId, sessionId }, out);
  if (clip.promised) {
    let swapped = false;
    try {
      swapped = typeof clip.useFallbackImage === 'function' && !!(await clip.useFallbackImage());
    } catch (_) { swapped = false; }
    // The report still goes (it matters more than the hint), but a stale "button" hint is never silent.
    if (!swapped) logToFile('❌ clip template refused and the app-hint image could not be stored: the report goes with a button hint and no button', { sessionId }, 'error');
  }
  return false;
}

/** @returns {Promise<'template'|null>} 'template' when the report went as the share template. */
async function sendReportByTemplateIfWindowClosed({ phone, userId, sessionId, clip }, deps) {
  if (!phone || !userId || !sessionId) return null;
  const d = { ...defaultDeps(), ...(deps || {}) };
  try {
    const button = !!(clip && clip.template && clip.token);
    if (!(button && clip.promised) && await d.windowOpen(phone)) return null;
    if (button && await sendClipTemplate({ userId, sessionId, clip }, d)) return 'template';
    const out = await d.sendShare({ userId, kind: 'dc', id: sessionId });
    const sent = !!out && out.status === 'sent';
    logOutcome(sent ? 'coaching.report.template_sent' : 'coaching.report.template_not_sent', { userId, sessionId }, out);
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
