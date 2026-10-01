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
const InboundTyping = require('../../inbound-typing');

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

// Meta bill cut FX3 (bd-w2daa.24): a photo absorbed into its burst sends nothing — the burst's
// one prompt (another request) answers it. So the wait holds this turn's "typing…" for its first
// second and checks then: already superseded → settle "nothing coming" (typing never goes up);
// still the newest → let typing show and wait out the rest.
const DEFAULT_BURST_EARLY_CHECK_MS = 1000;
function burstEarlyCheckMs() {
  const n = Number(process.env.COACHING_PHOTO_BURST_EARLY_CHECK_MS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BURST_EARLY_CHECK_MS;
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

// ─── Meta bill cut FX3 (bd-fr45b): photos sent together must not overwrite each other ──
// A gallery burst arrives as separate webhooks within a second, and each request resolved the
// session before any of them wrote: every one appended to the same stale classroom_photos and the
// last write won (sandbox 1 Oct 16:17:49Z — two photos, "Photo 1 of 3", one lost). The append now
// re-reads the row under a per-session lock — an in-process queue (requests on this replica) plus
// a Redis lock (other replicas) — the Global fix (lane I7, G1-17). Fail-safe both ways: no Redis,
// a Redis error, or a lock held past the wait → append anyway (never lose a photo, never block).
// The upload stays OUTSIDE the lock; the locked work is one read and one write.
const PHOTO_LOCK_TTL_SECONDS = 30;
const DEFAULT_PHOTO_LOCK_WAIT_MS = 10000;
const PHOTO_LOCK_POLL_MS = 100;
const localPhotoQueues = new Map();   // sessionId → tail of this replica's append queue

function photoLockWaitMs() {
  const n = Number(process.env.COACHING_PHOTO_LOCK_WAIT_MS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PHOTO_LOCK_WAIT_MS;
}

function queueLocally(sessionId, fn) {
  const prev = localPhotoQueues.get(sessionId) || Promise.resolve();
  const run = prev.then(fn);
  const tail = run.catch(() => {});
  localPhotoQueues.set(sessionId, tail);
  tail.then(() => { if (localPhotoQueues.get(sessionId) === tail) localPhotoQueues.delete(sessionId); });
  return run;
}

async function withRedisPhotoLock(sessionId, fn) {
  const { logToFile } = require('../../../utils/logger');
  let redis = null;
  try {
    redis = require('../../cache/railway-redis.service');
    if (!redis || typeof redis.isAvailable !== 'function' || !redis.isAvailable()) redis = null;
  } catch (_) { redis = null; }
  if (!redis) return fn();

  const resource = `coaching:photo_append:${sessionId}`;
  const lockId = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const deadline = Date.now() + photoLockWaitMs();
  let held = false;
  try {
    for (;;) {
      held = await redis.acquireLock(resource, lockId, PHOTO_LOCK_TTL_SECONDS);
      if (held || Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, PHOTO_LOCK_POLL_MS));
    }
  } catch (err) {
    logToFile('⚠️ Classroom photo lock unavailable — appending unlocked', { coachingSessionId: sessionId, error: err && err.message });
    held = false;
  }
  if (!held) logToFile('⚠️ Classroom photo lock not acquired — appending unlocked', { coachingSessionId: sessionId });
  try {
    return await fn();
  } finally {
    if (held) {
      try { await redis.releaseLock(resource, lockId); } catch (_) { /* the TTL frees it */ }
    }
  }
}

function withSessionPhotoLock(sessionId, fn) {
  return queueLocally(sessionId, () => withRedisPhotoLock(sessionId, fn));
}

/**
 * Append one stored photo to the session from a FRESH read, under the per-session lock.
 * The caller's earlier read is used only when the fresh read fails.
 * @returns {Promise<{photos: Array, added: boolean, full: boolean}>}
 */
async function appendPhotoLocked(session, photoUrl) {
  const supabase = require('../../../config/supabase');
  const { logToFile } = require('../../../utils/logger');
  return withSessionPhotoLock(session.id, async () => {
    let current = session;
    try {
      const { data: fresh } = await supabase
        .from('coaching_sessions')
        .select('status, conversation_state, classroom_photos')
        .eq('id', session.id)
        .maybeSingle();
      if (fresh) current = { ...session, ...fresh };
    } catch (err) {
      logToFile('⚠️ Classroom photo: fresh read failed — using the earlier read', { coachingSessionId: session.id, error: err && err.message });
    }
    const existing = current.classroom_photos || (current.conversation_state && current.conversation_state.classroom_photos) || [];
    const { photos, added, full } = appendClassroomPhoto(existing, photoUrl);
    if (added) await supabase.from('coaching_sessions').update(mergedPhotoUpdate(current, photos)).eq('id', session.id);
    return { photos, added, full };
  });
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
  // FX3 (bd-fr45b): from a fresh read under the per-session lock, so a burst keeps every photo.
  const { photos, added, full } = await appendPhotoLocked(session, photoUrl);

  if (!added) {
    // A sibling photo of the same burst filled the last slot first; it has already opened the
    // lesson-plan step, so this one answers nothing (a second LP prompt would be a duplicate).
    logToFile('📸 Classroom photo over the cap in the same burst — not stored', { coachingSessionId: session.id, photoCount: photos.length });
    InboundTyping.nothingComing({ reason: 'photo_over_cap_in_burst', answeredElsewhere: true });
    return photos.length;
  }

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

  const wait = photoPromptDebounceMs();
  const early = Math.min(wait, burstEarlyCheckMs());
  const releaseTyping = InboundTyping.hold();
  await new Promise((resolve) => setTimeout(resolve, early));
  const newestEarly = await stillNewest(session.id, token);
  if (newestEarly) releaseTyping(true);
  if (newestEarly && wait > early) {
    await new Promise((resolve) => setTimeout(resolve, wait - early));
  }
  if (!newestEarly || !(await stillNewest(session.id, token))) {
    logToFile('📸 Photo receipt folded into the burst prompt', { coachingSessionId: session.id, photoCount: count });
    InboundTyping.nothingComing({ reason: 'photo_burst_absorbed', answeredElsewhere: true });
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
        InboundTyping.nothingComing({ reason: 'photo_step_left' });
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
  const { uploadImageWithRetry } = require('../../../storage/r2');
  const { getUserLanguage } = require('../../../utils/language-cache');
  const { logToFile } = require('../../../utils/logger');

  const existing = session.classroom_photos || (session.conversation_state && session.conversation_state.classroom_photos) || [];
  if (Array.isArray(existing) && existing.length >= MAX_COACHING_PHOTOS) return existing.length;

  const photoUrl = await uploadImageWithRetry(imageBuffer, user.id, `${session.id}-${Date.now()}`, mimeType || 'image/jpeg');
  const { photos, added } = await appendPhotoLocked(session, photoUrl);   // FX3 (bd-fr45b)
  if (!added) {
    logToFile('📸 Held classroom photo over the cap — not stored', { coachingSessionId: session.id, photoCount: photos.length });
    return photos.length;
  }

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
