/**
 * bd-8s0dp — feature intro videos silently never sent: with R2_PUBLIC_URL
 * unset, FEATURE_VIDEO_URLS produce "/feature_videos/coaching_intro.mp4" and
 * extractKeyFromUrl returned the bare "key" WITH its leading slash. R2 keys
 * are literal, so "/feature_videos/…" ≠ "feature_videos/…" → NoSuchKey → the
 * graceful skip hid it. Live proof 2026-08-26: three NoSuchKey misses on
 * coaching_intro/reading_intro while both objects sat in the bucket.
 *
 * Contract: a bare-key input is normalized by stripping leading slashes; URL
 * shapes keep their existing behavior.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'digital-coach-audio';

const { extractKeyFromUrl } = require('../../bot/shared/storage/r2');

describe('bd-8s0dp · extractKeyFromUrl strips leading slashes on bare keys', () => {
  it('the exact live failure: "/feature_videos/coaching_intro.mp4" → key without slash', () => {
    expect(extractKeyFromUrl('/feature_videos/coaching_intro.mp4'))
      .toBe('feature_videos/coaching_intro.mp4');
  });
  it('a plain bare key passes through unchanged', () => {
    expect(extractKeyFromUrl('exams/uid/examid/file.docx'))
      .toBe('exams/uid/examid/file.docx');
  });
  it('path-style URLs keep their behavior', () => {
    expect(extractKeyFromUrl('https://acc.r2.cloudflarestorage.com/digital-coach-audio/feature_videos/x.mp4'))
      .toBe('feature_videos/x.mp4');
  });
  it('presigned URLs keep their behavior', () => {
    expect(extractKeyFromUrl('https://acc.r2.cloudflarestorage.com/digital-coach-audio/a/b.ogg?X-Amz-Signature=zz'))
      .toBe('a/b.ogg');
  });
  it('an http URL without the bucket marker still throws', () => {
    expect(() => extractKeyFromUrl('https://example.com/nope.mp4')).toThrow(/Could not extract/);
  });
});
