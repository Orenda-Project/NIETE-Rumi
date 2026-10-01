/**
 * bd-3ipd2 — shared classroom-photo capture used by the paths the image
 * webhook Phase 3 does NOT cover:
 *   - a photo sent as a DOCUMENT while on the photo step  → capturePhotoAndPrompt
 *   - a photo that races the class transcription/analysis → holdPhotoForSession
 *
 * Both write through the merge-safe appendClassroomPhoto helper so the
 * conversation_state is never clobbered (the state-management consistency fix).
 */

const { appendClassroomPhoto, MAX_COACHING_PHOTOS, CLASSROOM_PHOTO_STATUSES, isClassroomPhotoState } = require('../photo-capture-routing');

// ─── Meta bill cut NC4 (N2-C04): one receipt prompt per BURST of photos ──────
// Teachers send 2–3 photos seconds apart; each used to get its own
// "📸 Photo n received. Add another?" prompt. Now each arrival stamps a Redis
// token and waits PHOTO_PROMPT_DEBOUNCE_MS; only the LAST arrival of a burst
// still holds the token when it wakes, and it sends one prompt with the count it
// re-reads from the row. A later photo still gets its own prompt. No Redis → the
// prompt goes out at once, exactly as before. The cap path (3rd photo) takes the
// token too, so a pending "2 of 3" never lands after the lesson-plan prompt.
const PHOTO_PROMPT_TOKEN_TTL_SECONDS = 120;
const DEFAULT_PHOTO_PROMPT_DEBOUNCE_MS = 5000;
const promptKey = (sessionId) => `coaching:photo_prompt:${sessionId}`;

function photoPromptDebounceMs() {
  const n = Number(process.env.COACHING_PHOTO_PROMPT_DEBOUNCE_MS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PHOTO_PROMPT_DEBOUNCE_MS;
}

const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
/** Urdu prose takes the U+06Fx digits, never ASCII and never the Arabic U+066x set. */
const digits = (n, lang) => (lang === 'ur' ? String(n).replace(/[0-9]/g, (d) => UR_DIGITS[Number(d)]) : String(n));

/** Stamp this arrival as the newest of the burst. null = no Redis (do not debounce). */
async function stampArrival(sessionId) {
  try {
    const redis = require('../../cache/railway-redis.service');
    const token = `p:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    return (await redis.set(promptKey(sessionId), token, PHOTO_PROMPT_TOKEN_TTL_SECONDS)) ? token : null;
  } catch (_) {
    return null;
  }
}

async function stillNewest(sessionId, token) {
  try {
    const redis = require('../../cache/railway-redis.service');
    return (await redis.get(promptKey(sessionId))) === token;
  } catch (_) {
    return true;
  }
}

/** The receipt prompt — count + Add another / Done — in their language. */
function receiptPrompt(sessionId, count, lang) {
  const { resolveUx } = require('../../../config/ux-strings');
  return {
    body: resolveUx(count === 1 ? 'coachingPhotoReceivedOne' : 'coachingPhotoReceivedMany', {
      language: lang,
      params: { n: digits(count, lang), max: digits(MAX_COACHING_PHOTOS, lang) },
    }),
    buttons: [
      { id: `photo_more_${sessionId}`, title: resolveUx('coachingPhotoAddAnotherButton', { language: lang }) },
      { id: `photo_done_${sessionId}`, title: resolveUx('coachingPhotoDoneButton', { language: lang }) },
    ],
  };
}

function mergedPhotoUpdate(session, photos) {
  return {
    classroom_photos: photos,
    conversation_state: { ...(session.conversation_state || {}), classroom_photos: photos },
  };
}

/**
 * Store a photo for a session already ON the photo step, then prompt add-more /
 * done exactly like the image Phase 3 does. Used by the document-as-photo path.
 *
 * Who consumes the three button ids this file and photo-prompt.service emit
 * (bd-pzs9a — none of this was written down, and "Add another" was half-wired
 * for it):
 *   photo_done_  → whatsapp-bot.js, inline: LP prompt, then awaiting_lesson_plan
 *   photo_no_    → whatsapp-bot.js, inline: same, without a photo
 *   photo_more_  → classroom-photo/add-another.service
 *
 * This function deliberately does NOT touch status / current_state — leaving
 * them is what keeps the session on the photo step for the next image. That is
 * true of the write here; it was NOT true of the "Add another" tap, which said
 * "send the next photo" without ever checking that the session could still take
 * one. add-another.service now makes it true rather than assuming it.
 */
async function capturePhotoAndPrompt({ session, imageBuffer, mimeType, from, user }) {
  const supabase = require('../../../config/supabase');
  const { uploadImageWithRetry } = require('../../../storage/r2');
  const { getUserLanguage } = require('../../../utils/language-cache');
  const { logToFile } = require('../../../utils/logger');

  const { clampLanguage } = require('../../../config/ux-strings');
  const userLang = clampLanguage((await getUserLanguage(user.id)) || user.preferred_language);
  const existing = session.classroom_photos || (session.conversation_state && session.conversation_state.classroom_photos) || [];

  if (Array.isArray(existing) && existing.length >= MAX_COACHING_PHOTOS) {
    // bd-5azz0: max reached → the LP step, never straight to analysis (the
    // skip was why LP fidelity scored on nothing for photo-heavy coaches).
    // Meta bill cut NC4: the "maximum" line OPENS the LP prompt (one bubble).
    await stampArrival(session.id);
    const { advanceToLessonPlanStep } = require('../lp-coaching/lp-step.service');
    await advanceToLessonPlanStep({
      sessionId: session.id, from, tapperUserId: user.id,
      lead: { key: 'coachingPhotoMaxAlready', params: { max: digits(MAX_COACHING_PHOTOS, userLang) } },
    });
    return existing.length;
  }

  const photoUrl = await uploadImageWithRetry(imageBuffer, user.id, `${session.id}-${Date.now()}`, mimeType || 'image/jpeg');
  const { photos, full } = appendClassroomPhoto(existing, photoUrl);
  await supabase.from('coaching_sessions').update(mergedPhotoUpdate(session, photos)).eq('id', session.id);

  if (full) {
    // bd-5azz0: same routing as the webhook path — max lands on the LP step.
    // Meta bill cut NC4 (N2-C08): "📸 Photo 3 received. Maximum reached." opens
    // the LP prompt instead of going out as its own text. Taking the burst token
    // drops any pending "n of 3" prompt from a photo seconds before this one.
    await stampArrival(session.id);
    const { advanceToLessonPlanStep } = require('../lp-coaching/lp-step.service');
    await advanceToLessonPlanStep({
      sessionId: session.id, from, tapperUserId: user.id,
      lead: { key: 'coachingPhotoMaxReached', params: { n: digits(photos.length, userLang) } },
    });
  } else {
    await promptOncePerBurst({ session, from, userLang, count: photos.length });
  }
  logToFile('📸 Classroom photo captured (document path)', { coachingSessionId: session.id, photoCount: photos.length });
  return photos.length;
}

/**
 * Meta bill cut NC4 (N2-C04) — send the receipt prompt for the LAST photo of a
 * burst only. The count comes from the row as it stands when the wait ends, so
 * the one prompt names every photo of the burst.
 */
async function promptOncePerBurst({ session, from, userLang, count }) {
  const WhatsAppService = require('../../whatsapp.service');
  const { logToFile } = require('../../../utils/logger');

  const token = await stampArrival(session.id);
  if (!token) {
    await WhatsAppService.sendInteractiveButtons(from, receiptPrompt(session.id, count, userLang));
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, photoPromptDebounceMs()));
  if (!(await stillNewest(session.id, token))) {
    logToFile('📸 Photo receipt folded into the burst prompt', { coachingSessionId: session.id, photoCount: count });
    return;
  }

  let finalCount = count;
  try {
    const supabase = require('../../../config/supabase');
    const { data: fresh } = await supabase
      .from('coaching_sessions')
      .select('status, conversation_state, classroom_photos')
      .eq('id', session.id)
      .maybeSingle();
    if (fresh) {
      const onStep = CLASSROOM_PHOTO_STATUSES.includes(fresh.status)
        && isClassroomPhotoState(fresh.conversation_state && fresh.conversation_state.current_state);
      if (!onStep) {
        // They tapped Done (or the step moved on) while the burst settled — the
        // next step's own message is already in the chat.
        logToFile('📸 Burst prompt not sent — the session left the photo step meanwhile', {
          coachingSessionId: session.id, status: fresh.status,
        });
        return;
      }
      const stored = Array.isArray(fresh.classroom_photos) ? fresh.classroom_photos
        : (fresh.conversation_state && fresh.conversation_state.classroom_photos);
      if (Array.isArray(stored) && stored.length > 0) finalCount = stored.length;
    }
  } catch (_) { /* the count we already have is still true */ }

  await WhatsAppService.sendInteractiveButtons(from, receiptPrompt(session.id, finalCount, userLang));
}

/**
 * Store a photo that arrived BEFORE the photo prompt (raced the transcription),
 * and acknowledge it. No add-more buttons — the session isn't on the photo step
 * yet; the analysis (bd-gr48y) and report (bd-pv2tl) pick the photo up from
 * classroom_photos. Prevents the photo being lost to the pic-to-LP fallback.
 */
async function holdPhotoForSession({ session, imageBuffer, mimeType, from, user, messageId = null }) {
  const supabase = require('../../../config/supabase');
  const { uploadImageWithRetry } = require('../../../storage/r2');
  const { getUserLanguage } = require('../../../utils/language-cache');
  const { logToFile } = require('../../../utils/logger');

  const existing = session.classroom_photos || (session.conversation_state && session.conversation_state.classroom_photos) || [];
  if (Array.isArray(existing) && existing.length >= MAX_COACHING_PHOTOS) return existing.length;

  const photoUrl = await uploadImageWithRetry(imageBuffer, user.id, `${session.id}-${Date.now()}`, mimeType || 'image/jpeg');
  const { photos } = appendClassroomPhoto(existing, photoUrl);
  await supabase.from('coaching_sessions').update(mergedPhotoUpdate(session, photos)).eq('id', session.id);

  // Meta bill cut NC4 (N2-C07): a free 📸 reaction on their photo instead of the
  // billed "Got your classroom photo…" text. No wamid (a parked photo re-attached
  // after "which teacher?") or a reaction the pacer skipped → the text, as before.
  const { resolveUx, clampLanguage } = require('../../../config/ux-strings');
  const userLang = clampLanguage((await getUserLanguage(user.id)) || user.preferred_language);
  const { reactOrSay } = require('../ack-reaction');
  await reactOrSay({
    to: from, messageId, emoji: '📸', what: 'classroom photo held',
    text: resolveUx('coachingPhotoHeld', { language: userLang }),
  });
  logToFile('📸 Classroom photo held during processing (race path)', { coachingSessionId: session.id, photoCount: photos.length });
  return photos.length;
}

module.exports = { capturePhotoAndPrompt, holdPhotoForSession, DEFAULT_PHOTO_PROMPT_DEBOUNCE_MS };
