'use strict';
/**
 * bd-2475 — after a child declines the friend-invite offer, ask if they want
 * to binge more videos+quizzes. Yes opens the same Student Videos Flow
 * teachers get from /video, phone-keyed via child-flow-token.js so no
 * `users` row is ever created for a child. No tells them /video always works.
 *
 * Deliberately mirrors video-quiz-invite.service.js's shape (offer/handle
 * pair, own Redis key, claim-by-key-existence) rather than folding into it —
 * that file's own header draws a boundary around what crosses between
 * children; this is a different concern (routing back into the video menu).
 */

const redisService = require('../cache/railway-redis.service');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const ChildFlowToken = require('./child-flow-token');
const { resolveUx } = require('../../config/ux-strings');

const MORE_YES = 'vq_more_yes';
const MORE_NO = 'vq_more_no';
const MORE_TTL_SECS = 60 * 60;
const stripPlus = (p) => (p && p.startsWith('+') ? p.slice(1) : p);
const MORE_KEY = (phone) => `videoquiz:${stripPlus(phone)}:more`;

async function offerMore({ phone, studentId, shareCodeId, language = 'en',
                           sessionId = null, quizId = null }) {
  if (!studentId || !shareCodeId) return false;
  await redisService.set(MORE_KEY(phone), { studentId, shareCodeId, language, sessionId, quizId },
    MORE_TTL_SECS);
  // In the quiz language, from the catalog (bd-2yyry.9): the inline map this
  // replaced addressed the child in the feminine.
  await WhatsAppService.sendInteractiveButtons(phone, {
    body: resolveUx('vqMoreAsk', { language }),
    buttons: [
      { id: MORE_YES, title: resolveUx('vqMoreYes', { language }) },   // ≤ 20 code points, asserted in tests
      { id: MORE_NO, title: resolveUx('vqMoreNo', { language }) },
    ],
  });
  // Binge is only ever offered after an invite decline, which
  // only happens on a share_link session.
  logEvent('video_quiz.offer_shown', { kind: 'binge', sessionId, quizId, source: 'share_link', language });
  return true;
}

/** Handle the yes/no on the watch-more offer. Returns true if this button was ours. */
async function handleMoreButton(buttonId, phone) {
  if (buttonId !== MORE_YES && buttonId !== MORE_NO) return false;
  const ctx = await redisService.get(MORE_KEY(phone));
  await redisService.delete(MORE_KEY(phone));
  if (!ctx) return true;

  // An old in-flight ctx minted before this deploy has no
  // sessionId/quizId; they simply come out undefined/null here.
  const choice = buttonId === MORE_YES ? 'yes' : 'no';
  logEvent('video_quiz.offer_answered', {
    kind: 'binge', choice, studentId: ctx.studentId, shareCodeId: ctx.shareCodeId,
    sessionId: ctx.sessionId ?? null, quizId: ctx.quizId ?? null,
  });

  const language = ctx.language;

  if (buttonId === MORE_NO) {
    await WhatsAppService.sendMessage(phone, resolveUx('vqMoreDeclined', { language }));
    return true;
  }

  const { STUDENT_VIDEOS_FLOW_ID } = require('../../utils/constants');
  if (!STUDENT_VIDEOS_FLOW_ID) {
    logToFile('⚠️ video-quiz-binge: STUDENT_VIDEOS_FLOW_ID not configured', { phone });
    logEvent('video_quiz.binge_unavailable', { reason: 'flow_not_configured' });
    await WhatsAppService.sendMessage(phone, resolveUx('vqMoreUnavailable', { language }));
    return true;
  }

  const flowToken = ChildFlowToken.build({
    phone, shareCodeId: ctx.shareCodeId, studentId: ctx.studentId, language: ctx.language,
  });
  const sent = await WhatsAppService.sendFlow(phone, {
    flowId: STUDENT_VIDEOS_FLOW_ID,
    header: resolveUx('vqMoreFlowHeader', { language }),     // ≤ 60 code points
    body: resolveUx('vqMoreFlowBody', { language }),
    buttonText: resolveUx('vqMoreFlowButton', { language }), // ≤ 20 code points
    flowToken,
  });
  if (sent) {
    logEvent('video_quiz.binge_started', {
      sessionId: ctx.sessionId ?? null, quizId: ctx.quizId ?? null,
      shareCodeId: ctx.shareCodeId, language: ctx.language,
    });
  } else {
    logEvent('video_quiz.binge_unavailable', { reason: 'flow_send_failed' });
  }
  return true;
}

module.exports = { offerMore, handleMoreButton, MORE_YES, MORE_NO, MORE_KEY };
