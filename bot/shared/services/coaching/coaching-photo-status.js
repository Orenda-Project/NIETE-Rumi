/**
 * bd-2636 — the classroom-photo step exists under TWO (status, state) namings:
 *   - transcription path (transcription-processor):  status 'awaiting_photo'
 *     with conversation_state.current_state 'AWAITING_PHOTO' (or 'COLLECTING_PHOTOS')
 *   - photo_yes button (whatsapp-bot.js, commit 9506323): status
 *     'awaiting_classroom_photo' with current_state 'AWAITING_CLASSROOM_PHOTO'
 *
 * The image handler must accept BOTH — otherwise a teacher who taps "yes, add a
 * classroom photo" and sends it has the photo orphaned and her coaching session
 * frozen (no analysis, no report). Single source of truth for both sides.
 */

const CLASSROOM_PHOTO_STATUSES = ['awaiting_photo', 'awaiting_classroom_photo'];
const CLASSROOM_PHOTO_STATES = ['COLLECTING_PHOTOS', 'AWAITING_PHOTO', 'AWAITING_CLASSROOM_PHOTO'];

function isClassroomPhotoState(currentState) {
  return CLASSROOM_PHOTO_STATES.includes(currentState);
}

module.exports = { CLASSROOM_PHOTO_STATUSES, CLASSROOM_PHOTO_STATES, isClassroomPhotoState };
