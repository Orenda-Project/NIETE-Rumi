'use strict';
/**
 * The commit prompt after the coaching report (bd-v0toag.124): "Will you commit to trying this in your next class?"
 * with Yes / Later / No, led by the session-complete line when the card copy has one.
 *
 * When the report went as the share template (her 24 h window closed, bd-v0toag.106) the prompt is not sent: a
 * free-form send there is refused by Meta with 131047. Nothing is claimed or recorded, and the completion counts as
 * said so the caller sends no free-form session-complete line either.
 *
 * Meta bill cut NC5 (N1-13): once per session. A second run skips the send and counts the completion as said, because
 * the first run's prompt already said it. Returns whether the completion has been said.
 */

const WhatsAppService = require('../whatsapp.service');
const { claimPiece, releasePiece } = require('./report-piece-once');

async function sendCommitPrompt({ followUps, phone, coachingSessionId, cardCopy, track }) {
  if (!followUps) return true;
  if (!(await claimPiece(coachingSessionId, 'commit_prompt'))) return true;
  const lead = cardCopy.sessionCompleteLead;
  const promptSent = await WhatsAppService.sendInteractiveButtons(phone, {
    body: lead ? `${lead}\n\n${cardCopy.commitPrompt}` : cardCopy.commitPrompt,
    buttons: [
      { id: `card_yes_${coachingSessionId}`, title: cardCopy.commitButtons.yes },
      { id: `card_later_${coachingSessionId}`, title: cardCopy.commitButtons.later },
      { id: `card_no_${coachingSessionId}`, title: cardCopy.commitButtons.no },
    ],
  }, track.opts('buttons'));
  await track.record('buttons', promptSent !== false);
  if (promptSent === false) await releasePiece(coachingSessionId, 'commit_prompt');
  return Boolean(lead);
}

module.exports = { sendCommitPrompt };
