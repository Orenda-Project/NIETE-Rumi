'use strict';
/**
 * bd-snkn32.45 — a tap on the observed teacher's own plan in the WhatsApp lesson-plan list.
 *
 *   lp_own_{ownId}_{sessionId}            → "use this lesson plan?" (the bd-2c1gj confirm, naming her plan)
 *   lpconfirm_yes_own_{ownId}_{sessionId} → attach it (lp-own-plans.attachOwnPlan) and continue the flow
 *
 * Attaching writes her stored PDF onto the observation as the portal's Check and send does, then queues its
 * extraction. On a session still at the lesson-plan step the analysis is queued as for an uploaded plan
 * (lpUploaded); on a late tap (already analysed, review not submitted) the extraction worker's post-extraction
 * fidelity recompute (bd-5knlj) fills Section B, so nothing else is re-run. A plan that no longer resolves
 * (not hers, not ready, gone) attaches nothing and the list goes out again.
 * lp-list-selection.handler has already refused a cancelled session before this runs.
 */
const { logToFile, logWarn } = require('../../../utils/logger');
const { REVIEW_SUBMITTED_STATUSES } = require('../fidelity/fidelity-recompute.service');

async function handleOwnTap({ listId, sessionId, from, lang, status }, deps = {}) {
  const sendMessage = deps.sendMessage
    || ((to, text) => require('../../whatsapp.service').sendMessage(to, text));
  const sendButtons = deps.sendButtons
    || ((to, payload) => require('../../whatsapp.service').sendInteractiveButtons(to, payload));
  const queueAnalysis = deps.queueAnalysis
    || ((sid, payload) => require('../coaching-job-queue.service').queueAnalysis(sid, payload));
  const describeOwn = deps.describeOwn
    || ((sid, ownId, l) => require('./lp-own-plans').describeOwn(sid, ownId, l));
  const attachOwn = deps.attachOwn
    || ((sid, ownId) => require('./lp-own-plans').attachOwnPlan(sid, ownId));
  const resendList = deps.resendList
    || ((sid, to, l) => require('./lp-step.service').resendLpList({ sessionId: sid, from: to, lang: l }));
  const deferLpOutcome = deps.deferLpOutcome
    || (async ({ from: to, text }) => { await sendMessage(to, text); return {}; });
  const { getCoachingMessage } = deps.messages || require('../../../config/coaching-messages');

  const ownId = listId.slice('lp_own_'.length, -(sessionId.length + 1));
  if (REVIEW_SUBMITTED_STATUSES.includes(status)) {
    logToFile('[lp-own] late tap after review submitted — not attaching', { sessionId, status });
    await sendMessage(from, getCoachingMessage('lessonPlan_review_submitted', lang));
    return true;
  }

  if (!deps.confirmed) {
    const row = await describeOwn(sessionId, ownId, lang);
    const body = getCoachingMessage('lessonPlan_confirm_prompt', lang)
      .replace('{title}', (row && row.title) || getCoachingMessage('lessonPlan_confirm_fallback_title', lang))
      .replace('{details}', (row && row.description) || '');
    const asked = await sendButtons(from, {
      body: body.replace(/\n{3,}/g, '\n\n'),
      buttons: [
        { id: `lpconfirm_yes_own_${ownId}_${sessionId}`, title: getCoachingMessage('lessonPlan_confirm_yes', lang) },
        { id: `lpconfirm_no_${sessionId}`, title: getCoachingMessage('lessonPlan_confirm_change', lang) },
      ],
    });
    if (asked !== false) {
      logToFile('[lp-own] own plan picked — asked to confirm', { sessionId, ownId });
      return true;
    }
    logWarn('[lp-own] confirmation could not be sent — attaching without it', { sessionId, ownId });
  }

  let out = { attached: false };
  try { out = await attachOwn(sessionId, ownId); } catch (err) {
    logWarn('[lp-own] attaching her plan failed', { sessionId, ownId, error: err && err.message });
  }
  if (!out || !out.attached) {
    logWarn('[lp-own] her plan did not resolve — re-sending the list', { sessionId, ownId });
    const sent = await resendList(sessionId, from, lang);
    if (!sent) logWarn('[lp-own] could not re-send the LP menu', { sessionId });
    return true;
  }
  logToFile('[lp-own] her own plan attached to the observation', { sessionId, ownId, r2Key: out.r2Key });

  if (!status || status === 'awaiting_lesson_plan') {
    const extra = await deferLpOutcome({
      sessionId, from, messageKey: 'lessonPlan_linked', language: lang, sendMessage,
      text: getCoachingMessage('lessonPlan_linked', lang),
    });
    await queueAnalysis(sessionId, { from, lpUploaded: true, ...extra });
    return true;
  }
  // Late tap: the extraction just queued recomputes Section B when it lands (bd-5knlj).
  await sendMessage(from, getCoachingMessage('lessonPlan_linked', lang));
  return true;
}

module.exports = { handleOwnTap };
