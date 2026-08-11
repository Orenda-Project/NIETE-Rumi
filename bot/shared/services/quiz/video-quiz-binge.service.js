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
const ChildFlowToken = require('./child-flow-token');

const MORE_YES = 'vq_more_yes';
const MORE_NO = 'vq_more_no';
const MORE_TTL_SECS = 60 * 60;
const stripPlus = (p) => (p && p.startsWith('+') ? p.slice(1) : p);
const MORE_KEY = (phone) => `videoquiz:${stripPlus(phone)}:more`;

function moreStrings(language) {
  const map = {
    en: {
      body: 'Want to watch more videos and take more quizzes?',
      yes: 'Watch more', no: 'No thanks',
      declined: "No problem! You can always watch more videos and take quizzes anytime — just send /video and I'll show you the menu.",
      unavailable: "Sorry — picking more videos isn't available right now. Send /video in a bit and I'll show you the menu.",
    },
    ur: {
      body: 'کیا آپ مزید ویڈیوز دیکھنا اور مزید کوئز کرنا چاہیں گی؟',
      yes: 'مزید دیکھیں', no: 'ابھی نہیں',
      declined: 'کوئی بات نہیں! آپ کسی بھی وقت /video بھیج کر مزید ویڈیوز اور کوئز دیکھ سکتی ہیں۔',
      unavailable: 'معذرت — ابھی مزید ویڈیوز دستیاب نہیں ہیں۔ تھوڑی دیر میں /video بھیجیں۔',
    },
  };
  return map[language] || map.en;
}

/**
 * Offer the binge round after a child declines the friend-invite.
 *
 * Skipped without studentId/shareCodeId, same reasoning as offerInvite: with
 * no student to attribute the next round to, offering it is a promise we
 * cannot keep (the teacher's report would never see this child's next quiz).
 */
async function offerMore({ phone, studentId, shareCodeId, language = 'en' }) {
  if (!studentId || !shareCodeId) return false;
  await redisService.set(MORE_KEY(phone), { studentId, shareCodeId, language }, MORE_TTL_SECS);
  const t = moreStrings(language);
  await WhatsAppService.sendInteractiveButtons(phone, {
    body: t.body,
    buttons: [
      { id: MORE_YES, title: t.yes },
      { id: MORE_NO, title: t.no },
    ],
  });
  return true;
}

/** Handle the yes/no on the watch-more offer. Returns true if this button was ours. */
async function handleMoreButton(buttonId, phone) {
  if (buttonId !== MORE_YES && buttonId !== MORE_NO) return false;
  const ctx = await redisService.get(MORE_KEY(phone));
  await redisService.delete(MORE_KEY(phone));
  if (!ctx) return true;

  const t = moreStrings(ctx.language);

  if (buttonId === MORE_NO) {
    await WhatsAppService.sendMessage(phone, t.declined);
    return true;
  }

  const { STUDENT_VIDEOS_FLOW_ID } = require('../../utils/constants');
  if (!STUDENT_VIDEOS_FLOW_ID) {
    logToFile('⚠️ video-quiz-binge: STUDENT_VIDEOS_FLOW_ID not configured', { phone });
    await WhatsAppService.sendMessage(phone, t.unavailable);
    return true;
  }

  const flowToken = ChildFlowToken.build({
    phone, shareCodeId: ctx.shareCodeId, studentId: ctx.studentId, language: ctx.language,
  });
  await WhatsAppService.sendFlow(phone, {
    flowId: STUDENT_VIDEOS_FLOW_ID,
    header: '🎬 More Videos',
    body: 'Pick a class, subject and topic — I will send the video to your chat.',
    buttonText: 'Browse',
    flowToken,
  });
  return true;
}

module.exports = { offerMore, handleMoreButton, MORE_YES, MORE_NO, MORE_KEY };
