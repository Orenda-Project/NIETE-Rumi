'use strict';
/**
 * bd-ri5o9.1 — route the teacher's tap on the report-invite template.
 *
 * A teacher outside the 24h window is offered her report through an approved
 * UTILITY template whose QUICK_REPLY carries `observe_report_<sessionId>`
 * (observe-send.service.js). The worker phase that delivers on that tap
 * ('teacher_tap') has existed since bd-25 — but NOTHING ever read the payload,
 * so nothing ever enqueued the phase. It was implemented and unreachable.
 *
 * The tap therefore fell into the bd-kggts fallthrough in whatsapp-bot.js, which
 * routes an unmatched template button's LABEL into the general text handler. The
 * assistant then read "FICO" in its US-credit-score sense and told four of Sana
 * Nawaz's teachers it had "no access to official FICO credit reports".
 *
 * Production at the time of the fix: `tapped_at` set on 0 of 624 deliveries;
 * 120 reports stuck at awaiting_teacher_tap, 47 already abandoned by the bd-2675
 * planner — which is event-closed on precisely this tap.
 *
 * Kept as a pure module (the photo-capture-routing pattern) so the routing
 * decision is unit-testable without booting the bot.
 */

const TEMPLATE_PAYLOAD_PREFIX = 'observe_report_';

/**
 * The template's visible button label, per market language.
 *
 * Meta strips the payload on some template registrations — already learned here
 * on bd-2482 — so the label is the fallback signal for "this was the report
 * button". It can only ever establish INTENT, never WHICH report: see
 * matchObserveReportTap.
 */
const OBSERVE_REPORT_TAP_TEXTS = Object.freeze([
  'get report',
  'رپورٹ بھیجیں',
  'رپورٹ حاصل کریں',
]);

const _norm = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Does this button text mean "send me the report"?
 * @param {string} text the template button's visible label
 * @returns {boolean}
 */
function isObserveReportTapText(text) {
  const t = _norm(text).toLowerCase();
  if (!t) return false;
  return OBSERVE_REPORT_TAP_TEXTS.includes(t);
}

/**
 * Resolve a template button into the coaching session whose report it offers.
 *
 * Deliberately payload-only. The label tells us the teacher wants her report but
 * never WHICH one, and a teacher may hold more than one invite; inferring a
 * session from the text would eventually deliver the wrong teacher's report. A
 * text-only tap is handled by the caller (log it, let the coach resend) rather
 * than guessed at here.
 *
 * @param {{payload?: string, text?: string}} btn
 * @returns {string|null} coaching session id, or null when this is not our button
 */
function matchObserveReportTap(btn) {
  const payload = _norm(btn && btn.payload);
  if (!payload.startsWith(TEMPLATE_PAYLOAD_PREFIX)) return null;
  const sessionId = payload.slice(TEMPLATE_PAYLOAD_PREFIX.length).trim();
  return sessionId || null;
}

module.exports = {
  matchObserveReportTap,
  isObserveReportTapText,
  OBSERVE_REPORT_TAP_TEXTS,
  TEMPLATE_PAYLOAD_PREFIX,
};
