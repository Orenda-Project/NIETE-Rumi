'use strict';
/**
 * Route an LP-selection prompt to the correct WhatsApp send method (bd-lqpog).
 *
 * buildLPSelectionList returns EITHER:
 *   - { type: 'buttons', body, buttons }           when there are no recent LPs
 *   - { type: 'list', listData: {header,body,footer,action} }  when recent LPs exist
 *
 * A list payload MUST go to sendInteractiveMessage. sendInteractiveButtons
 * destructures `{ body, buttons }` and does `buttons.length`, which THROWS on a
 * list payload — crashing the message handler so the teacher receives nothing and
 * coaching stalls at awaiting_lesson_plan. (The list branch was dead code until
 * LP_FIDELITY_ENABLED was enabled.)
 */
async function sendLpPrompt(WhatsAppService, to, lpPrompt) {
  if (lpPrompt && lpPrompt.type === 'list' && lpPrompt.listData) {
    return WhatsAppService.sendInteractiveMessage(to, lpPrompt.listData);
  }
  return WhatsAppService.sendInteractiveButtons(to, lpPrompt);
}

module.exports = { sendLpPrompt };
