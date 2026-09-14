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
  const isUrdu = language === 'ur';

  return {
    // bd-8s2xb — say WHAT to photograph. Of 84 real uploads read for bd-drg79, two-thirds were
    // the class seated at desks, which no FICO indicator can use; the board, a student's work
    // and the materials used are what the scorer can verify (B1/B3/B6/C2/F5/F6/F8/F10).
    // Copy approved by the operator 2026-09-14. Body cap 1,024 code points (≈285 here).
    body: isUrdu
      ? '📸 کیا آپ 3 تک تصاویر شامل کرنا چاہیں گے؟ سب سے مفید: (1) بورڈ جس پر آج کا مقصد یا کام لکھا ہو، (2) کسی طالبِ علم کی کاپی یا ورک شیٹ، (3) جو چیز آپ نے سمجھانے کے لیے استعمال کی — ڈرائنگ، کوئی چیز، چارٹ یا کارڈز۔ بچوں کے ڈیسک پر بیٹھے ہونے کی تصویر تجزیے میں مدد نہیں کرتی۔'
      : "📸 Would you like to add up to 3 photos? The most useful ones: (1) the board with today's objective or the task, (2) a student's notebook or worksheet, (3) anything you used to explain — a drawing, object, chart or cards. A photo of the class at their desks does not help the analysis.",
    buttons: [
      { id: `photo_yes_${coachingSessionId}`, title: isUrdu ? 'ہاں' : 'Yes' },
      { id: `photo_no_${coachingSessionId}`, title: isUrdu ? 'نہیں' : 'No' },
    ],
  };
}

module.exports = { buildPhotoPrompt };
