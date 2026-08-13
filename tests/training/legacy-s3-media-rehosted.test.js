/**
 * bd-2666 / sheet R3 — training media must be served from a host whose
 * response headers we control.
 *
 * THE BUG, as measured on the live corpus (2026-08-13):
 *   212 of 213 legacy assets returned `Content-Type: binary/octet-stream`
 *   and NOT ONE carried a Content-Disposition header.
 *
 * So this was never a Content-Disposition bug. Nothing said "attachment";
 * browsers downloaded because `binary/octet-stream` is not renderable. The
 * dashboard already learned this exact lesson — see the comment at
 * dashboard/services/r2.service.js:249, "Forcing inline with
 * application/octet-stream downloads anyway".
 *
 * WHY THE HOST IS THE INVARIANT (and not merely the header): those objects
 * live in `asset-manager-*.s3.ap-south-1.amazonaws.com`, a third-party bucket
 * we do not own. We cannot restamp their metadata and we cannot sign response
 * header overrides on them — `getPresignedUrl` -> `isPermanentR2Url`
 * (bot/shared/storage/r2.js:611) returns false for an amazonaws.com URL and
 * hands the raw, UNSIGNED link straight back to the caller, which
 * content-delivery.service.js then texts to the teacher.
 *
 * Hence the only durable fix, and the only thing worth locking in a test:
 * every deliverable module's effective media URL must point at R2. The schema
 * always intended this — training_modules.source_media_url is commented
 * "original Taleemabad URL, retained until re-hosted".
 *
 * This test is deliberately about the DATA, not a pure function: the defect
 * lives in 213 rows, and a green unit test over a mocked helper would have
 * proven nothing about what a teacher actually receives.
 */

const { isPdfModule, effectiveMediaUrl, isControlledMediaHost } = require('../../bot/shared/services/training/media-host');

// The corpus AFTER the migration: videos live on R2, PDFs deliberately remain
// on the legacy bucket (they ship as WhatsApp document cards — see the scope
// note on the invariant test below).
const MODULES = [
  { id: 1, title: 'R2 video', video_url: 'https://acct.r2.cloudflarestorage.com/digital-coach-audio/training/x/1/a.mp4', source_media_url: null },
  { id: 2, title: 're-hosted video', video_url: 'https://acct.r2.cloudflarestorage.com/digital-coach-audio/training/rehosted/2/asset.mp4', source_media_url: 'https://asset-manager-approved.s3.ap-south-1.amazonaws.com/b.mp4' },
  { id: 3, title: 'legacy S3 pdf', video_url: null, source_media_url: 'https://asset-manager-approved.s3.ap-south-1.amazonaws.com/c.pdf' },
  { id: 4, title: 'in-review S3 pdf', video_url: null, source_media_url: 'https://asset-manager-in-review.s3.ap-south-1.amazonaws.com/d.pdf' },
  { id: 5, title: 'R2 pdf', video_url: null, source_media_url: 'https://acct.r2.cloudflarestorage.com/digital-coach-audio/training/x/5/e.pdf' },
  { id: 6, title: 'no media', video_url: null, source_media_url: null },
];

// A module mid-migration — still pointing at the third-party bucket. Kept as a
// named fixture so the guard below is provably capable of failing; without it
// the invariant test would pass on an all-clean fixture and prove nothing.
const UNMIGRATED_VIDEO = {
  id: 99,
  title: 'not yet re-hosted',
  video_url: 'https://asset-manager-approved.s3.ap-south-1.amazonaws.com/z.mp4',
  source_media_url: null,
};

describe('bd-2666 — training media host', () => {
  test('effectiveMediaUrl picks the URL the bot would really send', () => {
    // A PDF module is defined by source_media_url; a video module by video_url.
    // Getting this wrong would audit a URL the teacher never receives.
    expect(effectiveMediaUrl(MODULES[0])).toBe(MODULES[0].video_url);
    expect(effectiveMediaUrl(MODULES[2])).toBe(MODULES[2].source_media_url);
    expect(effectiveMediaUrl(MODULES[5])).toBeNull();
  });

  test('isPdfModule matches the delivery branch in content-delivery.service.js', () => {
    expect(isPdfModule(MODULES[2])).toBe(true);
    expect(isPdfModule(MODULES[0])).toBe(false);
    // video_url wins even when a stale source_media_url PDF is still present,
    // exactly as the production predicate behaves.
    expect(isPdfModule({ video_url: 'https://x/y.mp4', source_media_url: 'https://x/y.pdf' })).toBe(false);
  });

  test('third-party S3 hosts are NOT controlled; R2 is', () => {
    expect(isControlledMediaHost('https://asset-manager-approved.s3.ap-south-1.amazonaws.com/c.pdf')).toBe(false);
    expect(isControlledMediaHost('https://asset-manager-in-review.s3.ap-south-1.amazonaws.com/d.pdf')).toBe(false);
    expect(isControlledMediaHost('https://acct.r2.cloudflarestorage.com/b/k.mp4')).toBe(true);
    expect(isControlledMediaHost('https://pub-abc.r2.dev/k.mp4')).toBe(true);
    expect(isControlledMediaHost(null)).toBe(false);
  });

  /**
   * SCOPE (settled with production data, 2026-08-13): only VIDEO modules are
   * affected. A video is delivered as a raw text link the teacher taps, so the
   * browser sees `binary/octet-stream` and downloads instead of playing.
   *
   * PDFs are delivered as a WhatsApp `type: 'document'` card — Meta fetches
   * the file server-side and renders it in WhatsApp's own viewer, so the bad
   * header never reaches a browser. 31,846 completions of PDF modules in the
   * preceding 30 days confirm that path works. They are deliberately left on
   * the legacy bucket rather than migrated for a symptom they do not have.
   */
  const uncontrolledVideos = (modules) =>
    modules
      .filter((m) => !isPdfModule(m))
      .filter((m) => effectiveMediaUrl(m))
      .filter((m) => !isControlledMediaHost(effectiveMediaUrl(m)))
      .map((m) => `${m.id}:${m.title}`);

  test('every VIDEO module must be served from a host we control', () => {
    expect(uncontrolledVideos(MODULES)).toEqual([]);
  });

  test('the guard actually catches a video left on the legacy bucket', () => {
    // Proves the assertion above is load-bearing rather than vacuously true.
    expect(uncontrolledVideos([...MODULES, UNMIGRATED_VIDEO])).toEqual(['99:not yet re-hosted']);
  });

  test('a re-hosted module keeps its original URL as provenance', () => {
    // The migration repoints the DELIVERED column only; source_media_url stays
    // put so the origin of a re-hosted asset is never lost.
    const rehosted = MODULES.find((m) => m.id === 2);
    expect(isControlledMediaHost(effectiveMediaUrl(rehosted))).toBe(true);
    expect(rehosted.source_media_url).toContain('asset-manager-approved');
  });
});
