/**
 * Photo Prompt Service
 *
 * Builds the WhatsApp interactive buttons config for asking
 * the teacher if they want to share a classroom photo.
 *
 * Bead: (Phase 1C-B)
 */

/**
 * Build the photo prompt interactive buttons config.
 *
 * @param {string} coachingSessionId - Session UUID
 * @param {string} language - User's language (en, ur, etc.)
 * @returns {{ body: string, buttons: Array<{id: string, title: string}> }}
 */
function buildPhotoPrompt(coachingSessionId, language = 'en') {
  // bd-8s2xb — strings live in the catalog (Rule 20), not an inline en/ur map.
  const { resolveUx } = require('../../../config/ux-strings');
  const ux = (key) => resolveUx(key, { language });
  return {
    body: ux('coachingPhotoOffer'),
    buttons: [
      { id: `photo_yes_${coachingSessionId}`, title: ux('coachingPhotoOfferYes') },
      { id: `photo_no_${coachingSessionId}`, title: ux('coachingPhotoOfferNo') },
    ],
  };
}

/**
 * Meta bill cut NC4 (N2-C10) — the photo offer, opened by `lead` (the prior-
 * commitment reminder) when the whole body fits WhatsApp's 1,024 code-point cap.
 * `leadMerged: false` → the caller sends the lead on its own first, as before.
 *
 * @returns {{ prompt: { body: string, buttons: Array }, leadMerged: boolean }}
 */
function buildPhotoPromptWithLead(coachingSessionId, language = 'en', lead = null) {
  const prompt = buildPhotoPrompt(coachingSessionId, language);
  if (!lead) return { prompt, leadMerged: false };
  const body = `${lead}\n\n${prompt.body}`;
  if ([...body].length > 1024) return { prompt, leadMerged: false };
  return { prompt: { ...prompt, body }, leadMerged: true };
}

module.exports = { buildPhotoPrompt, buildPhotoPromptWithLead };
