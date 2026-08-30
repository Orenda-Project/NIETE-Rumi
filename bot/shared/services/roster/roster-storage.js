'use strict';
/**
 * /roster — keeping the register photos.
 *
 * Until 2026-08-30 we kept nothing. A page was decrypted from Meta's CDN into
 * memory, handed to the vision model, and garbage-collected; the photos a coach
 * had taken were gone the moment the request ended, and no extraction could be
 * audited after the fact. For a feature whose output is a school's student roster,
 * and whose known failure mode is a confidently wrong name, that is the wrong
 * default: the photo IS the evidence.
 *
 * WHERE. Its own bucket (`studentrosters-ict`), not the bot's general R2 bucket —
 * this is children's roster data and it should be separable from lesson plans and
 * audio by a bucket policy rather than by a key prefix. Credentials are read from
 * ROSTER_R2_*, falling back to the bot's R2_* when they are not set, so a
 * deployment that has not been given the new bucket keeps working (it just stores
 * nothing, loudly).
 *
 * RETENTION IS INDEFINITE. Operator decision, 2026-08-30: keep everything for now.
 * There is no expiry rule in this code and none on the bucket; when a retention
 * policy is chosen it belongs on the bucket as a lifecycle rule, not here, so it
 * applies to what is already stored as well as to what arrives next.
 *
 * NO NEW TABLES. The join lives in the key — `registers/{schoolId}/{runId}/page-NN.jpg`
 * — and the run's `manifest.json` carries the class, the coach, the model, the raw
 * model output and the list that was actually saved. An auditor needs the bucket and
 * nothing else, which is why this costs zero schema (root CLAUDE.md rule 15).
 *
 * BEST EFFORT, ALWAYS. A bucket outage must never cost a coach the class she just
 * photographed and corrected by hand. Every function here resolves to
 * `{ ok: false, error }` and logs; none of them throws into the Flow.
 */

// Required lazily. The SDK is a bot dependency and this module is unit-tested with
// an injected client; a top-level require would make the tests need the whole
// bot dependency tree to assert a key format.
const sdk = () => require('@aws-sdk/client-s3');
const { logToFile } = require('../../utils/logger');

/** A path segment that cannot escape the prefix it is written into. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertSegment(name, value) {
  if (!SAFE_SEGMENT.test(String(value || ''))) {
    throw new Error(`roster-storage: unsafe ${name} '${value}'`);
  }
  return String(value);
}

function bucketName() {
  return process.env.ROSTER_R2_BUCKET || '';
}

let cachedClient = null;

/**
 * The S3 client for the roster bucket. ROSTER_R2_* first — the roster bucket needs
 * credentials that can reach it, and the bot's own R2 key is scoped to the bot's
 * own bucket, so falling back is a convenience for local runs, not a substitute.
 */
function client() {
  if (cachedClient) return cachedClient;
  const endpoint = process.env.ROSTER_R2_ENDPOINT || process.env.R2_ENDPOINT;
  const accessKeyId = process.env.ROSTER_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.ROSTER_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  cachedClient = new (sdk().S3Client)({
    region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey },
  });
  return cachedClient;
}

/** `registers/{schoolId}/{runId}/page-NN.jpg` — pages sort in page order. */
function pageKey(schoolId, runId, index) {
  const s = assertSegment('schoolId', schoolId);
  const r = assertSegment('runId', runId);
  return `registers/${s}/${r}/page-${String(index + 1).padStart(2, '0')}.jpg`;
}

/** The audit record for one /roster run, beside the pages it describes. */
function manifestKey(schoolId, runId) {
  const s = assertSegment('schoolId', schoolId);
  const r = assertSegment('runId', runId);
  return `registers/${s}/${r}/manifest.json`;
}

async function put(key, body, contentType, deps) {
  const bucket = deps.bucket !== undefined ? deps.bucket : bucketName();
  if (!bucket) return { ok: false, skipped: true };

  const c = deps.client !== undefined ? deps.client : client();
  if (!c) return { ok: false, skipped: true };

  // The command is constructed through the injected client's own shape in tests,
  // so the SDK is only reached when there is a real client to send it with.
  const Put = deps.PutObjectCommand || sdk().PutObjectCommand;
  await c.send(new Put({
    Bucket: bucket, Key: key, Body: body, ContentType: contentType,
  }));
  return { ok: true, key, bucket };
}

/**
 * Store one register page exactly as it was read.
 *
 * The bytes are the decrypted original, not a re-encode: an audit of "did the model
 * misread this?" has to look at the same pixels the model did.
 */
async function putPage({ schoolId, runId, index, buffer, contentType = 'image/jpeg' }, deps = {}) {
  try {
    return await put(pageKey(schoolId, runId, index), buffer, contentType, deps);
  } catch (err) {
    logToFile('[roster] page not stored', { runId, index, error: err.message }, 'error');
    return { ok: false, error: err.message };
  }
}

/** Store the run's audit record. */
async function putManifest({ schoolId, runId, manifest }, deps = {}) {
  try {
    const body = JSON.stringify(manifest, null, 2);
    return await put(manifestKey(schoolId, runId), body, 'application/json', deps);
  } catch (err) {
    logToFile('[roster] manifest not stored', { runId, error: err.message }, 'error');
    return { ok: false, error: err.message };
  }
}

/** A run id that is safe as a key segment and readable in a bucket listing. */
function newRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('Z', '');
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  pageKey, manifestKey, putPage, putManifest, newRunId, bucketName,
};
