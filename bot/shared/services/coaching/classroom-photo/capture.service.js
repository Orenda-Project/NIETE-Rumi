/**
 * bd-3ipd2 — shared classroom-photo capture used by the paths the image
 * webhook Phase 3 does NOT cover:
 *   - a photo sent as a DOCUMENT while on the photo step  → capturePhotoAndPrompt
 *   - a photo that races the class transcription/analysis → holdPhotoForSession
 *
 * Both write through the merge-safe appendClassroomPhoto helper so the
 * conversation_state is never clobbered (the state-management consistency fix).
 */

const { appendClassroomPhoto, MAX_COACHING_PHOTOS } = require('../photo-capture-routing');

function mergedPhotoUpdate(session, photos) {
  return {
    classroom_photos: photos,
    conversation_state: { ...(session.conversation_state || {}), classroom_photos: photos },
  };
}

/**
 * Store a photo for a session already ON the photo step, then prompt add-more /
 * done exactly like the image Phase 3 does. Used by the document-as-photo path.
 */
async function capturePhotoAndPrompt({ session, imageBuffer, mimeType, from, user }) {
  const WhatsAppService = require('../../whatsapp.service');
  const supabase = require('../../../config/supabase');
  const { uploadImageWithRetry } = require('../../../storage/r2');
  const { getUserLanguage } = require('../../../utils/language-cache');
  const { logToFile } = require('../../../utils/logger');

  const userLang = (await getUserLanguage(user.id)) || user.preferred_language || 'en';
  const existing = session.classroom_photos || (session.conversation_state && session.conversation_state.classroom_photos) || [];

  if (Array.isArray(existing) && existing.length >= MAX_COACHING_PHOTOS) {
    // bd-5azz0: max reached → the LP step, never straight to analysis (the
    // skip was why LP fidelity scored on nothing for photo-heavy coaches).
    await WhatsAppService.sendMessage(from, userLang === 'ur'
      ? '📸 زیادہ سے زیادہ 3 تصاویر بھیجی جا سکتی ہیں۔'
      : '📸 You can upload a maximum of 3 photos.');
    const { advanceToLessonPlanStep } = require('../lp-coaching/lp-step.service');
    await advanceToLessonPlanStep({ sessionId: session.id, from, tapperUserId: user.id });
    return existing.length;
  }

  const photoUrl = await uploadImageWithRetry(imageBuffer, user.id, `${session.id}-${Date.now()}`, mimeType || 'image/jpeg');
  const { photos, full } = appendClassroomPhoto(existing, photoUrl);
  await supabase.from('coaching_sessions').update(mergedPhotoUpdate(session, photos)).eq('id', session.id);

  if (full) {
    // bd-5azz0: same routing as the webhook path — max lands on the LP step.
    await WhatsAppService.sendMessage(from, userLang === 'ur'
      ? `📸 تصویر ${photos.length} موصول۔ زیادہ سے زیادہ حد پوری ہو گئی ہے۔`
      : `📸 Photo ${photos.length} received. Maximum reached.`);
    const { advanceToLessonPlanStep } = require('../lp-coaching/lp-step.service');
    await advanceToLessonPlanStep({ sessionId: session.id, from, tapperUserId: user.id });
  } else {
    await WhatsAppService.sendInteractiveButtons(from, {
      body: userLang === 'ur'
        ? `📸 تصویر ${photos.length} موصول۔ کیا ایک اور تصویر شامل کرنی ہے؟`
        : `📸 Photo ${photos.length} received. Would you like to add another photo?`,
      buttons: [
        { id: `photo_more_${session.id}`, title: userLang === 'ur' ? 'مزید تصویر' : 'Add another' },
        { id: `photo_done_${session.id}`, title: userLang === 'ur' ? 'مکمل' : 'Done' },
      ],
    });
  }
  logToFile('📸 Classroom photo captured (document path)', { coachingSessionId: session.id, photoCount: photos.length });
  return photos.length;
}

/**
 * Store a photo that arrived BEFORE the photo prompt (raced the transcription),
 * and acknowledge it. No add-more buttons — the session isn't on the photo step
 * yet; the analysis (bd-gr48y) and report (bd-pv2tl) pick the photo up from
 * classroom_photos. Prevents the photo being lost to the pic-to-LP fallback.
 */
async function holdPhotoForSession({ session, imageBuffer, mimeType, from, user }) {
  const WhatsAppService = require('../../whatsapp.service');
  const supabase = require('../../../config/supabase');
  const { uploadImageWithRetry } = require('../../../storage/r2');
  const { getUserLanguage } = require('../../../utils/language-cache');
  const { logToFile } = require('../../../utils/logger');

  const existing = session.classroom_photos || (session.conversation_state && session.conversation_state.classroom_photos) || [];
  if (Array.isArray(existing) && existing.length >= MAX_COACHING_PHOTOS) return existing.length;

  const photoUrl = await uploadImageWithRetry(imageBuffer, user.id, `${session.id}-${Date.now()}`, mimeType || 'image/jpeg');
  const { photos } = appendClassroomPhoto(existing, photoUrl);
  await supabase.from('coaching_sessions').update(mergedPhotoUpdate(session, photos)).eq('id', session.id);

  const userLang = (await getUserLanguage(user.id)) || user.preferred_language || 'en';
  await WhatsAppService.sendMessage(from, userLang === 'ur'
    ? '📸 تصویر موصول ہو گئی — میں اسے آپ کی کلاس کے تجزیے کے ساتھ شامل کر لوں گا۔'
    : "📸 Got your classroom photo — I'll include it with your lesson analysis.");
  logToFile('📸 Classroom photo held during processing (race path)', { coachingSessionId: session.id, photoCount: photos.length });
  return photos.length;
}

module.exports = { capturePhotoAndPrompt, holdPhotoForSession };
