'use strict';
/**
 * bd-s0ccn5.2.3 — a presigned download link for an FLN plan's pre-rendered PDF on the portal's private bucket.
 *
 * The PDFs are rendered offline (scripts/fln-pdf/render.js) to fln/pdf/<corpus version>/<id>.pdf. A plan whose PDF
 * was never rendered has no link: the object is checked with a HEAD first, so the portal never hands a teacher a
 * URL that answers 404 from the bucket. Fails closed to null on missing env, a HEAD miss or any bucket error.
 *
 * Same credentials as fln-media-sign.js (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).
 * Short expiry: the link is fetched on the tap and used at once, unlike the plan's media which a tab keeps open.
 */
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const EXPIRES_S = 15 * 60;

let client = null;
let clientFor = '';

function config() {
  const env = process.env;
  const bucket = (env.R2_BUCKET_NAME || '').trim();
  const endpoint = (env.R2_ENDPOINT || '').trim();
  if (!bucket || !endpoint || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null;
  return { bucket, endpoint, id: env.R2_ACCESS_KEY_ID, secret: env.R2_SECRET_ACCESS_KEY };
}

function r2(cfg) {
  const k = `${cfg.endpoint}|${cfg.id}`;
  if (!client || clientFor !== k) {
    client = new S3Client({ region: 'auto', endpoint: cfg.endpoint, credentials: { accessKeyId: cfg.id, secretAccessKey: cfg.secret } });
    clientFor = k;
  }
  return client;
}

const defaultHead = (cfg, key) => r2(cfg).send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key })).then(() => true, () => false);

let head = defaultHead;
let presign = getSignedUrl;

/** A short-lived download URL for `key`, or null when the object is absent or the bucket is unreachable. */
async function pdfUrl(key, filename) {
  const cfg = config();
  if (!cfg) return null;
  try {
    if (!(await head(cfg, key))) return null;
    const safe = String(filename || 'lesson.pdf').replace(/[^A-Za-z0-9 ._-]/g, '').trim() || 'lesson.pdf';
    const url = await presign(r2(cfg), new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safe}"`,
      ResponseContentType: 'application/pdf',
    }), { expiresIn: EXPIRES_S });
    return typeof url === 'string' && url ? url : null;
  } catch (_) {
    console.error('❌ FLN pdf: link unavailable', { key });
    return null;
  }
}

function __setForTests({ head: h, presign: p } = {}) {
  head = h || defaultHead;
  presign = p || getSignedUrl;
}

module.exports = { pdfUrl, EXPIRES_S, __setForTests };
