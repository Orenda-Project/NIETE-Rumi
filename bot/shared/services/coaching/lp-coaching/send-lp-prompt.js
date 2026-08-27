'use strict';
/**
 * Route an LP-selection prompt to the correct WhatsApp send method (bd-lqpog).
 *
 * buildLPSelectionList returns EITHER:
 *   - { type: 'buttons', body, buttons }                        when there are no recent LPs
 *   - { type: 'list', listData: {...}, fallback: {buttons} }     when recent LPs exist
 *
 * A list payload MUST go to sendInteractiveMessage. sendInteractiveButtons
 * destructures `{ body, buttons }` and does `buttons.length`, which THROWS on a
 * list payload — crashing the message handler so the teacher receives nothing and
 * coaching stalls at awaiting_lesson_plan. (The list branch was dead code until
 * LP_FIDELITY_ENABLED was enabled.)
 *
 * bd-zrlcp — sendInteractiveMessage does NOT throw when it refuses a payload; it
 * returns FALSE (over the 10-row cap, no sections, or a transport failure) and
 * never contacts Meta. Ignoring that return is what stranded 20 sessions on
 * 2026-08-27: callers had already moved the session to awaiting_lesson_plan, so
 * it sat at a step the teacher was never shown, with no sweeper to recover it.
 * A refused list now falls back to the 2-row Yes/No prompt, which always fits.
 *
 * @returns {Promise<boolean>} true only when a prompt actually went out. Callers
 *   MUST gate the awaiting_lesson_plan transition on this.
 */
async function sendLpPrompt(WhatsAppService, to, lpPrompt) {
  if (lpPrompt && lpPrompt.type === 'list' && lpPrompt.listData) {
    const sent = await WhatsAppService.sendInteractiveMessage(to, lpPrompt.listData);
    if (sent) return true;
    if (lpPrompt.fallback) {
      return (await WhatsAppService.sendInteractiveButtons(to, lpPrompt.fallback)) !== false;
    }
    return false;
  }
  return (await WhatsAppService.sendInteractiveButtons(to, lpPrompt)) !== false;
}

module.exports = { sendLpPrompt };
