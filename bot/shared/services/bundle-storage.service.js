/**
 * — S3 storage for OTA web bundles.
 *
 * Ports the shape of the retired Django implementation's storage client (put the
 * zip in a `frontend-bundles/` prefix, keep the object private, hand out a
 * short-lived presigned GET) with two changes:
 *
 *   1. A DEDICATED BUCKET, not the one the retired service used. Same AWS
 *      account, separate bucket, its own IAM user scoped to that bucket only —
 *      so this pipeline cannot read or write whatever else lived alongside the
 *      old bundles.
 *
 *   2. A SHA-256 IS COMPUTED AT UPLOAD and returned to the caller to persist.
 *      Integrity was never verified before, so a truncated download was
 *      indistinguishable from a good one. The device checks this before
 *      applying a bundle.
 *
 * Objects stay PRIVATE. The bucket must not be public-read: a public bundle URL
 * is an unauthenticated download of our app's code, and it would also let a
 * device pin a URL forever rather than re-asking which bundle it should run.
 *
 * Credentials come from the environment only — never a literal in this file.
 * The repo is public.
 */
const crypto = require('crypto');

const PREFIX = 'frontend-bundles';

/** Presigned GET lifetime. Long enough for a slow rural download, no longer. */
const URL_TTL_SECONDS = 3600;

function config() {
  const bucket = process.env.OTA_BUNDLE_BUCKET;
  const region = process.env.OTA_BUNDLE_REGION;
  const accessKeyId = process.env.OTA_BUNDLE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OTA_BUNDLE_SECRET_ACCESS_KEY;

  // Fail loudly and specifically. A half-configured storage layer that throws
  // deep inside the SDK is the kind of thing that gets wrapped in a bare catch
  // and silently degrades — which is exactly the class of bug this pipeline
  // exists to remove.
  const missing = [
    ['OTA_BUNDLE_BUCKET', bucket],
    ['OTA_BUNDLE_REGION', region],
    ['OTA_BUNDLE_ACCESS_KEY_ID', accessKeyId],
    ['OTA_BUNDLE_SECRET_ACCESS_KEY', secretAccessKey],
  ].filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    throw new Error(
      `OTA bundle storage is not configured — missing ${missing.join(', ')}`,
    );
  }
  return { bucket, region, accessKeyId, secretAccessKey };
}

function client() {
  const { region, accessKeyId, secretAccessKey } = config();
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/** Deterministic object key. One object per (version, environment). */
function objectKey(bundleVersion, environment) {
  return `${PREFIX}/${environment}/${bundleVersion}.zip`;
}

/**
 * Upload a bundle zip and return its URL + checksum.
 *
 * The checksum is computed here, over the exact bytes that were sent, rather
 * than trusting a value supplied by the caller — a caller-supplied hash proves
 * nothing about what actually landed in the bucket.
 *
 * @param {Buffer} bytes
 * @param {{bundleVersion:number, environment:string}} meta
 * @returns {Promise<{bundleUrl:string, checksumSha256:string}>}
 */
async function uploadBundle(bytes, { bundleVersion, environment }) {
  const { bucket, region } = config();
  const key = objectKey(bundleVersion, environment);

  const checksumSha256 = crypto.createHash('sha256').update(bytes).digest('hex');

  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: 'application/zip',
      // Belt-and-braces: S3 verifies this server-side and rejects a corrupted
      // upload rather than storing it.
      ChecksumSHA256: Buffer.from(checksumSha256, 'hex').toString('base64'),
    }),
  );

  return {
    bundleUrl: `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
    checksumSha256,
  };
}

/**
 * Short-lived presigned GET for a stored bundle.
 *
 * Takes the stored URL (not a key) so callers persist one canonical value and
 * this function owns the key-extraction detail.
 */
async function signBundleUrl(bundleUrl) {
  const { bucket } = config();
  const key = new URL(bundleUrl).pathname.replace(/^\//, '');

  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: URL_TTL_SECONDS },
  );
}

module.exports = { uploadBundle, signBundleUrl, objectKey, URL_TTL_SECONDS };
