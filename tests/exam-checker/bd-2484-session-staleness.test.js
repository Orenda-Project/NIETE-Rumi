/**
 * bd-2484 — defense-in-depth: an ACCIDENTAL exam session (started but never
 * used) must auto-expire, so it can't linger and recapture chat if the teacher
 * never types an exit word or slash command.
 *
 * Guard is deliberately narrow: it only expires a session that is still in
 * `collecting_images`, has ZERO images, and is untouched for over an hour. A
 * session with images or one that has advanced past collection (a real grading
 * in progress) is NEVER expired.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: {},
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
  delete: jest.fn(async () => {}),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const ExamSessionService = require('../../bot/shared/services/exam-checker/exam-session.service');

const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

describe('_isStaleCollectingSession', () => {
  it('is stale: collecting_images, no images, untouched > 1h', () => {
    expect(ExamSessionService._isStaleCollectingSession({
      status: 'collecting_images', original_images: [], updated_at: hoursAgo(2),
    })).toBe(true);
  });

  it('is NOT stale when recent (within the hour)', () => {
    expect(ExamSessionService._isStaleCollectingSession({
      status: 'collecting_images', original_images: [], updated_at: hoursAgo(0.2),
    })).toBe(false);
  });

  it('is NOT stale when the teacher has already uploaded images', () => {
    expect(ExamSessionService._isStaleCollectingSession({
      status: 'collecting_images', original_images: [{ url: 'x' }], updated_at: hoursAgo(5),
    })).toBe(false);
  });

  it('is NOT stale once the session has advanced past collection', () => {
    expect(ExamSessionService._isStaleCollectingSession({
      status: 'grading', original_images: [], updated_at: hoursAgo(5),
    })).toBe(false);
  });

  it('falls back to created_at when updated_at is absent, and is safe on bad timestamps', () => {
    expect(ExamSessionService._isStaleCollectingSession({
      status: 'collecting_images', original_images: [], created_at: hoursAgo(3),
    })).toBe(true);
    expect(ExamSessionService._isStaleCollectingSession({
      status: 'collecting_images', original_images: [], updated_at: 'not-a-date',
    })).toBe(false);
  });
});
