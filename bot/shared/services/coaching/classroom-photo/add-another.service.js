'use strict';
/**
 * bd-pzs9a — the "Add another" tap on the classroom-photo prompt.
 *
 * capture.service offers three buttons after a photo lands: `photo_more_`,
 * `photo_done_`, `photo_no_`. The last two MOVE the session on (to
 * awaiting_lesson_plan). `photo_more_` had a handler, but it only ever sent
 * "Please send the next photo." — it never read the session and never wrote to
 * it. Which is fine while the session happens to still be on the photo step, and
 * wrong the moment it is not:
 *
 *   She taps Done (or a third photo auto-advances) → the session is at
 *   awaiting_lesson_plan. She then taps the older "Add another" bubble, is told
 *   to send a photo, and sends one. The LP gate takes it, OCRs it as a lesson
 *   plan, and tells her it is not a lesson plan. 85 such events across 51
 *   sessions and 39 teachers.
 *
 * So the tap now makes the session true to what the button says, rather than
 * assuming it: it RE-ANCHORS the session on the classroom-photo step, re-points
 * the media target at this observation so the next photo binds here (a coach
 * running two observations back-to-back, R165), and names the state it is
 * actually in when it cannot — at the cap, or past the photo window.
 *
 * Extracted out of whatsapp-bot.js's `photo_more_` branch (which now only
 * dispatches) so this can be executed by a test: the branch itself is
 * unreachable from jest inside a 2,800-line express entry point.
 *
 * Load (pre-merge Class R): one keyed single-row read, one keyed single-row
 * update and one Redis SETNX per tap. No scans, no fat columns.
 */

const supabase = require('../../../config/supabase');
const redisService = require('../../cache/railway-redis.service');
const { logToFile } = require('../../../utils/logger');
const { resolveUx, clampLanguage } = require('../../../config/ux-strings');
const { MAX_COACHING_PHOTOS, CLASSROOM_PHOTO_STATUSES } = require('../photo-capture-routing');
const { drivesSession } = require('../session-ownership');
const MediaTarget = require('../media-target.service');

// WhatsApp delivers webhooks at-least-once, and a teacher on a slow handset taps
// twice. Both must land as ONE prompt and ONE write. The key carries the photo
// COUNT so a genuine later tap — after the photo she was asked for arrived —
// is a different key and still prompts.
const TAP_LOCK_TTL_SECONDS = 300;
const tapKey = (sessionId, photoCount) => `coaching:photo_more:${sessionId}:${photoCount}`;

// Statuses from which the photo step can still be re-opened. The two photo
// statuses (she is already there) plus awaiting_lesson_plan — the step Done /
// No / photo-max move her to, and the one this bug lives in. Anything further
// on (analysis running, report generated, completed, cancelled) is NOT
// re-opened: a photo cannot join an analysis that has already read the set.
const REOPENABLE_STATUSES = [...CLASSROOM_PHOTO_STATUSES, 'awaiting_lesson_plan'];

const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
/** Urdu prose takes the U+06Fx digits, never ASCII and never the Arabic U+066x set. */
const digits = (n, lang) => (lang === 'ur' ? String(n).replace(/[0-9]/g, (d) => UR_DIGITS[Number(d)]) : String(n));

function photosOf(session) {
  if (Array.isArray(session.classroom_photos)) return session.classroom_photos;
  const held = session.conversation_state && session.conversation_state.classroom_photos;
  return Array.isArray(held) ? held : [];
}

/** The TAPPER's language — read from preferred_language, never user.language. */
async function tapperLanguage(userId, fallback) {
  const { data } = await supabase
    .from('users')
    .select('preferred_language')
    .eq('id', userId)
    .maybeSingle();
  return clampLanguage((data && data.preferred_language) || fallback);
}

/**
 * `photo_more_<sessionId>` — "Add another".
 *
 * @param {{ sessionId: string, from: string, user: { id: string, preferred_language?: string } }} args
 */
async function handleAddAnotherPhotoTap({ sessionId, from, user }) {
  const WhatsAppService = require('../../whatsapp.service');
  if (!sessionId || !user || !user.id) return;

  const { data: session } = await supabase
    .from('coaching_sessions')
    .select('id, status, user_id, observer_user_id, observation_type, conversation_state, classroom_photos')
    .eq('id', sessionId)
    .maybeSingle();

  if (!session) {
    logToFile('📸 "Add another" for a session that no longer exists — ignoring', { sessionId, userId: user.id });
    return;
  }

  // bd-wwcgf: the observed teacher on a leader_observation is its subject, not
  // its driver. Only the driver's tap may move the session.
  if (!drivesSession(user.id, session)) {
    logToFile('📸 "Add another" from someone who does not drive this session — ignoring', {
      sessionId, userId: user.id, status: session.status,
    });
    return;
  }

  const photos = photosOf(session);

  const claimed = await redisService.setNX(tapKey(sessionId, photos.length), '1', TAP_LOCK_TTL_SECONDS);
  if (!claimed) {
    logToFile('🔁 Duplicate "Add another" tap — skipping', { sessionId, userId: user.id, photoCount: photos.length });
    return;
  }

  const lang = await tapperLanguage(user.id, user.preferred_language);

  if (!REOPENABLE_STATUSES.includes(session.status)) {
    await WhatsAppService.sendMessage(from, resolveUx('photoAddAnotherClosed', { language: lang }));
    logToFile('📸 "Add another" on a session past the photo window — not re-opened', {
      sessionId, userId: user.id, status: session.status,
    });
    return;
  }

  if (photos.length >= MAX_COACHING_PHOTOS) {
    // Say the actual state, then land on the LP step — bd-5azz0's rule that the
    // photo-max path never skips the lesson-plan ask.
    await WhatsAppService.sendMessage(from, resolveUx('photoAddAnotherAtMax', {
      language: lang,
      params: { max: digits(MAX_COACHING_PHOTOS, lang) },
    }));
    const { advanceToLessonPlanStep } = require('../lp-coaching/lp-step.service');
    await advanceToLessonPlanStep({ sessionId, from, tapperUserId: user.id });
    logToFile('📸 "Add another" at the photo cap — advanced to the LP step instead', {
      sessionId, userId: user.id, photoCount: photos.length,
    });
    return;
  }

  // Re-anchor BEFORE prompting. If the send fails she is not told, but her photo
  // still lands on the photo gate; prompting first and failing to write would
  // send the photo she was just asked for into the lesson-plan branch — the bug.
  // MERGE conversation_state: it carries the photos already uploaded.
  await supabase
    .from('coaching_sessions')
    .update({
      status: 'awaiting_classroom_photo',
      conversation_state: {
        ...(session.conversation_state || {}),
        current_state: 'AWAITING_CLASSROOM_PHOTO',
      },
    })
    .eq('id', sessionId);

  // R165: the next photo belongs to THIS observation, not the coach's newest.
  await MediaTarget.setTarget(user.id, sessionId, 'photo');

  await WhatsAppService.sendMessage(from, resolveUx('photoAddAnotherNext', {
    language: lang,
    params: { n: digits(photos.length + 1, lang), max: digits(MAX_COACHING_PHOTOS, lang) },
  }));

  logToFile('📸 "Add another" — session re-anchored on the classroom-photo step', {
    sessionId, userId: user.id, photoCount: photos.length, reopenedFrom: session.status,
  });
}

module.exports = { handleAddAnotherPhotoTap, REOPENABLE_STATUSES, TAP_LOCK_TTL_SECONDS };
