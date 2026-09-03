/**
 * bd-2636 (NIETE DC incident) — classroom-photo status mismatch.
 *
 * The transcription path leaves a session at status='awaiting_photo' /
 * state='AWAITING_PHOTO' and asks "add a classroom photo? (yes/no)". The
 * photo_yes button (whatsapp-bot.js, commit 9506323) then flips it to
 * status='awaiting_classroom_photo' / state='AWAITING_CLASSROOM_PHOTO'. But the
 * image handler only accepted 'awaiting_photo' + ('COLLECTING_PHOTOS'|'AWAITING_PHOTO'),
 * so a teacher who taps "yes" and sends a photo has it orphaned — the session
 * freezes, analysis never runs, no report. The handler must accept BOTH namings.
 */

const {
  isClassroomPhotoState,
  CLASSROOM_PHOTO_STATUSES,
  CLASSROOM_PHOTO_STATES,
} = require('../../bot/shared/services/coaching/coaching-photo-status');
const fs = require('fs');
const path = require('path');

describe('bd-2636 — classroom-photo acceptance covers both namings', () => {
  it('accepts the button-flow state AWAITING_CLASSROOM_PHOTO', () => {
    expect(isClassroomPhotoState('AWAITING_CLASSROOM_PHOTO')).toBe(true);
  });
  it('still accepts the transcription-flow states', () => {
    expect(isClassroomPhotoState('AWAITING_PHOTO')).toBe(true);
    expect(isClassroomPhotoState('COLLECTING_PHOTOS')).toBe(true);
  });
  it('rejects unrelated states', () => {
    expect(isClassroomPhotoState('GENERATING_REPORT')).toBe(false);
    expect(isClassroomPhotoState(null)).toBe(false);
  });
  it('the status filter includes both awaiting_photo and awaiting_classroom_photo', () => {
    expect(CLASSROOM_PHOTO_STATUSES).toEqual(expect.arrayContaining(['awaiting_photo', 'awaiting_classroom_photo']));
  });
});

describe('bd-2636 — the photo gate actually uses the widened filter (source guard)', () => {
  // R165 (bd-2kxxa.2): the image handler no longer queries coaching_sessions
  // itself — it delegates to media-attach.service, whose media-session-resolver
  // carries the widened filter. Guard the resolver AND the delegation.
  const handlerSrc = fs.readFileSync(path.join(__dirname, '../../bot/shared/handlers/image-message.handler.js'), 'utf8');
  const resolverSrc = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/coaching/media-session-resolver.js'), 'utf8');
  it('the image handler routes classroom photos through the shared media-attach service', () => {
    expect(handlerSrc).toMatch(/media-attach\.service/);
    expect(handlerSrc).toMatch(/handlePhotoArrival\(/);
    expect(handlerSrc).not.toMatch(/\.eq\('status',\s*'awaiting_photo'\)/);
  });
  it('the resolver queries coaching_sessions by the CLASSROOM_PHOTO_STATUSES set, not a single status', () => {
    expect(resolverSrc).toMatch(/CLASSROOM_PHOTO_STATUSES/);
    expect(resolverSrc).toMatch(/isClassroomPhotoState/);
    expect(resolverSrc).not.toMatch(/\.eq\('status',\s*'awaiting_photo'\)/);
  });
});
