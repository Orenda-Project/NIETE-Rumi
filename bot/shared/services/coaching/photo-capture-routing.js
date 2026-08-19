/**
 * bd-3ipd2 — decide how an incoming image should be captured for coaching.
 *
 * NIETE captured 0 classroom photos across 864 sessions. Two silent losses:
 *  1. Photo sent AS A DOCUMENT (Android "Document" picker / full-res send) hits
 *     handleDocumentMessage, which only ever handled AUDIO — the image was dropped.
 *  2. Photo sent DURING transcription/analysis (before the photo prompt exists)
 *     fell through to the pic-to-LP "send a textbook page" path and was lost.
 *
 * Pure + supabase-free so it is unit-testable; the handlers supply the I/O.
 */

// The classroom-photo step exists under TWO (status, state) namings — the
// transcription path (`awaiting_photo` / `AWAITING_PHOTO`|`COLLECTING_PHOTOS`)
// and the photo_yes button (`awaiting_classroom_photo` / `AWAITING_CLASSROOM_PHOTO`).
// Both MUST be accepted or a teacher who taps "yes, add a photo" has it orphaned
// (the bd-2636 fix — present on main, MISSING on develop until this module).
// This module is the single source of truth for both sides.
const CLASSROOM_PHOTO_STATUSES = ['awaiting_photo', 'awaiting_classroom_photo'];
const CLASSROOM_PHOTO_STATES = ['COLLECTING_PHOTOS', 'AWAITING_PHOTO', 'AWAITING_CLASSROOM_PHOTO'];

function isClassroomPhotoState(currentState) {
  return CLASSROOM_PHOTO_STATES.includes(currentState);
}

// States where the class recording is being processed and the photo prompt has not
// arrived yet — a photo landing now should be HELD (attached to the session), not
// routed to pic-to-LP. Terminal states are absent (a photo after them starts fresh).
const PRE_PHOTO_PROCESSING_STATUSES = new Set([
  'initiated', 'confirmed', 'pending',
  'transcribing', 'transcription_complete',
  'analyzing', 'analysis_started', 'analysis_complete', 'generating_report',
]);

// After this long a "still processing" session is treated as stale — a new image
// starts fresh rather than being held against a dead session.
const HOLD_WINDOW_MS = 30 * 60 * 1000;

const MAX_COACHING_PHOTOS = 3;

function isImageMime(mimeType) {
  return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/');
}

/**
 * A photo sent as a DOCUMENT while the teacher is on the photo step must be
 * captured exactly like an image (same double-gate as image-message Phase 3).
 */
function shouldCaptureDocumentAsClassroomPhoto(session, mimeType) {
  if (!isImageMime(mimeType) || !session) return false;
  return CLASSROOM_PHOTO_STATUSES.includes(session.status)
    && isClassroomPhotoState(session.conversation_state && session.conversation_state.current_state);
}

/**
 * A photo that arrives while the class recording is still being processed (before
 * the photo prompt) should be HELD against the session, not sent to pic-to-LP.
 */
function shouldHoldImageForActiveCoaching(session, nowMs = Date.now()) {
  if (!session || !PRE_PHOTO_PROCESSING_STATUSES.has(session.status)) return false;
  const stamp = Date.parse(session.created_at || session.updated_at || '');
  if (Number.isNaN(stamp)) return true; // unknown age but mid-processing → hold (safer)
  return nowMs - stamp <= HOLD_WINDOW_MS;
}

/**
 * Merge-safe append of a photo to a classroom_photos array (never mutates input,
 * never exceeds the cap).
 * @returns {{photos:Array, added:boolean, full:boolean}}
 */
function appendClassroomPhoto(existing, url, uploadedAt, max = MAX_COACHING_PHOTOS) {
  const arr = Array.isArray(existing) ? existing.slice() : [];
  if (arr.length >= max) return { photos: arr, added: false, full: true };
  arr.push({ url, uploaded_at: uploadedAt || new Date().toISOString() });
  return { photos: arr, added: true, full: arr.length >= max };
}

module.exports = {
  CLASSROOM_PHOTO_STATUSES,
  CLASSROOM_PHOTO_STATES,
  isClassroomPhotoState,
  PRE_PHOTO_PROCESSING_STATUSES,
  HOLD_WINDOW_MS,
  MAX_COACHING_PHOTOS,
  isImageMime,
  shouldCaptureDocumentAsClassroomPhoto,
  shouldHoldImageForActiveCoaching,
  appendClassroomPhoto,
};
