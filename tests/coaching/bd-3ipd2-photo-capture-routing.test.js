/**
 * bd-3ipd2 — routing decisions for capturing a classroom photo reliably.
 */
const {
  isImageMime,
  shouldCaptureDocumentAsClassroomPhoto,
  shouldHoldImageForActiveCoaching,
  appendClassroomPhoto,
  MAX_COACHING_PHOTOS,
} = require('../../bot/shared/services/coaching/photo-capture-routing');

const NOW = 1_800_000_000_000;
const photoStepSession = (status = 'awaiting_classroom_photo', current = 'AWAITING_CLASSROOM_PHOTO') =>
  ({ status, conversation_state: { current_state: current } });

describe('bd-3ipd2 — isImageMime', () => {
  it('accepts image/* and rejects others', () => {
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('IMAGE/PNG')).toBe(true);
    expect(isImageMime('application/pdf')).toBe(false);
    expect(isImageMime(undefined)).toBe(false);
  });
});

describe('bd-3ipd2 — shouldCaptureDocumentAsClassroomPhoto', () => {
  it('captures an image document when the session is on the photo step', () => {
    expect(shouldCaptureDocumentAsClassroomPhoto(photoStepSession('awaiting_photo', 'AWAITING_PHOTO'), 'image/jpeg')).toBe(true);
    expect(shouldCaptureDocumentAsClassroomPhoto(photoStepSession(), 'image/png')).toBe(true);
  });
  it('does NOT capture a non-image document', () => {
    expect(shouldCaptureDocumentAsClassroomPhoto(photoStepSession(), 'application/pdf')).toBe(false);
  });
  it('does NOT capture when the session is not on the photo step', () => {
    expect(shouldCaptureDocumentAsClassroomPhoto({ status: 'analyzing', conversation_state: { current_state: 'ANALYZING' } }, 'image/jpeg')).toBe(false);
    expect(shouldCaptureDocumentAsClassroomPhoto(null, 'image/jpeg')).toBe(false);
  });
  it('does NOT capture when status matches but current_state is stale (respects the double-gate)', () => {
    expect(shouldCaptureDocumentAsClassroomPhoto({ status: 'awaiting_photo', conversation_state: { current_state: 'AWAITING_LESSON_PLAN' } }, 'image/jpeg')).toBe(false);
  });
});

describe('bd-3ipd2 — shouldHoldImageForActiveCoaching', () => {
  it('holds an image sent during recent processing (transcribing/analyzing)', () => {
    for (const s of ['transcribing', 'analyzing', 'analysis_started', 'confirmed']) {
      expect(shouldHoldImageForActiveCoaching({ status: s, created_at: new Date(NOW - 60_000).toISOString() }, NOW)).toBe(true);
    }
  });
  it('does NOT hold for a terminal/photo-step/absent session (those are handled elsewhere)', () => {
    expect(shouldHoldImageForActiveCoaching({ status: 'completed', created_at: new Date(NOW).toISOString() }, NOW)).toBe(false);
    expect(shouldHoldImageForActiveCoaching({ status: 'awaiting_photo', created_at: new Date(NOW).toISOString() }, NOW)).toBe(false);
    expect(shouldHoldImageForActiveCoaching(null, NOW)).toBe(false);
  });
  it('does NOT hold a stale processing session (older than the window)', () => {
    expect(shouldHoldImageForActiveCoaching({ status: 'transcribing', created_at: new Date(NOW - 40 * 60 * 1000).toISOString() }, NOW)).toBe(false);
  });
});

describe('bd-3ipd2 — appendClassroomPhoto (merge-safe)', () => {
  it('appends without mutating the input', () => {
    const existing = [{ url: 'a' }];
    const { photos, added } = appendClassroomPhoto(existing, 'b', '2026-01-01T00:00:00Z');
    expect(added).toBe(true);
    expect(photos).toHaveLength(2);
    expect(existing).toHaveLength(1); // input untouched
    expect(photos[1]).toEqual({ url: 'b', uploaded_at: '2026-01-01T00:00:00Z' });
  });
  it('refuses to exceed the cap', () => {
    const full = Array.from({ length: MAX_COACHING_PHOTOS }, (_, i) => ({ url: `p${i}` }));
    const { added, full: isFull, photos } = appendClassroomPhoto(full, 'extra');
    expect(added).toBe(false);
    expect(isFull).toBe(true);
    expect(photos).toHaveLength(MAX_COACHING_PHOTOS);
  });
  it('handles a null/undefined existing array', () => {
    expect(appendClassroomPhoto(null, 'a', 't').photos).toHaveLength(1);
  });
});
