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

module.exports = { buildPhotoPrompt };
