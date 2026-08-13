/**
 * Which host is a training asset served from, and is it one whose response
 * headers we control?
 *
 * Training media arrives from two places. R2 objects we upload ourselves carry
 * a real Content-Type (see getContentType in bot/shared/storage/r2.js), so a
 * browser renders them inline. Legacy assets still sitting on the third-party
 * `asset-manager-*.s3.ap-south-1.amazonaws.com` buckets serve
 * `binary/octet-stream`, which no browser will render — that is the download
 * prompt teachers reported, and it is a Content-TYPE problem, not a
 * Content-Disposition one (none of those objects sets a disposition at all).
 *
 * We cannot restamp metadata on a bucket we do not own, and `getPresignedUrl`
 * refuses to sign a non-R2 URL (isPermanentR2Url, r2.js:611) — it returns the
 * raw link unchanged. So "is this host ours?" is the property that actually
 * predicts whether a teacher gets an inline view, and it is the property the
 * re-host migration has to drive to true.
 *
 * These predicates are extracted rather than re-implemented so the migration
 * script, the delivery service and the tests all agree on which URL a given
 * module would really send.
 */

/**
 * The delivery branch predicate, mirroring content-delivery.service.js:32-37.
 * A module is a PDF module iff it has no video_url and its source_media_url
 * ends in .pdf — video_url always wins when both are present.
 */
function isPdfModule(m) {
  if (!m) return false;
  if (m.video_url) return false;
  if (!m.source_media_url) return false;
  return /\.pdf(\?|$)/i.test(m.source_media_url);
}

/**
 * The URL the bot would actually put in front of a teacher for this module.
 * Auditing anything else (e.g. always source_media_url) would measure a link
 * that is never sent.
 */
function effectiveMediaUrl(m) {
  if (!m) return null;
  if (isPdfModule(m)) return m.source_media_url || null;
  return m.video_url || null;
}

/**
 * True when the object lives somewhere we can set Content-Type and sign
 * response-header overrides — i.e. our own R2. Deliberately an allowlist: a
 * new third-party CDN should read as uncontrolled until proven otherwise.
 */
function isControlledMediaHost(url) {
  if (!url) return false;
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  if (host.endsWith('.r2.cloudflarestorage.com')) return true;
  if (host.endsWith('.r2.dev')) return true;
  // Honour an explicitly configured R2 endpoint / public domain.
  for (const envKey of ['R2_ENDPOINT', 'R2_PUBLIC_URL']) {
    const configured = process.env[envKey];
    if (!configured) continue;
    try {
      if (new URL(configured).host === host) return true;
    } catch {
      /* a malformed env value must never widen the allowlist */
    }
  }
  return false;
}

module.exports = { isPdfModule, effectiveMediaUrl, isControlledMediaHost };
