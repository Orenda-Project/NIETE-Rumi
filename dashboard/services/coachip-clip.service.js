'use strict';
/**
 * bd-sex15q.16 — COACHIP's quiet R2 helper for the two media streams (contracts/API.md §10 R7/R8, "Never"; SPEC v2 §7).
 *
 * The server fetches the bytes and pipes them; no URL to the bucket ever reaches a payload, a header or a log line.
 * A recording key is classroom_audio/<users.id>/…, so a key names a teacher: this module logs at most an error's name,
 * never err.message from AWS or ffmpeg (both echo the key or the signed URL), and never calls r2.service's
 * generatePresignedUrl / streamFromR2, which log the key and default to a one-hour link.
 *
 *   presign(location)                      a 300 s signed GetObject, for ffmpeg only
 *   streamObject(req, res, {bucket, key})  one Range passed through; 200 / 206 / 416; 'missing' lets the caller fall back
 *   liveCut(req, res, {audioUrl, …})       the disagreements cut (coach-disagreement-clip.js openClip, its 20 s budget)
 *
 * Every client is built on first use, never at require time (the no-eager-sdk-construction rule of r2.service.js).
 */
const { isValidR2Url, getInlineContentTypeFromKey } = require('./r2.service');

const PRESIGN_TTL_S = 300;
const RANGE_RX = /^bytes=\d*-\d*$/;
const FULL_ENVS = new Set(['sandbox', 'staging', 'production']);
const AUDIO_BY_EXT = {
  webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', amr: 'audio/amr',
};

/** The headers every audio answer carries (API.md §10.4): inline with no file name, never cached, never sniffed. */
function audioHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

/** The one Range we pass on: a single bytes=a-b; anything else (several ranges, another unit, garbage) is the whole object. */
function rangeOf(header) {
  return typeof header === 'string' && RANGE_RX.test(header) && header !== 'bytes=-' ? header : null;
}

const statusOf = (err) => (err && err.$metadata && err.$metadata.httpStatusCode) || null;
const isMissing = (err) => !!err && (err.name === 'NoSuchKey' || err.Code === 'NoSuchKey' || err.name === 'NotFound' || statusOf(err) === 404);
const isBadRange = (err) => !!err && (err.name === 'InvalidRange' || err.Code === 'InvalidRange' || statusOf(err) === 416);
/** The only thing a failure logs: what failed and the error's class. */
function logFailure(what, err) {
  console.error(`[coachip-media] ${what} failed:`, (err && (err.name || err.code)) || 'Error');
}

/** An audio type for a recording: the stored type when it is audio, else the key's extension, else mp3. */
function audioTypeFor(key, storedType) {
  if (typeof storedType === 'string' && /^audio\//i.test(storedType)) return storedType;
  const inline = getInlineContentTypeFromKey(key);
  if (inline && inline.startsWith('audio/') && inline !== 'audio/opus') return inline;
  const base = String(key || '').split(/[?#]/)[0].split('/').pop();
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  return AUDIO_BY_EXT[ext] || 'audio/mpeg';
}

/**
 * @param {object} [deps]
 * @param {{send: Function}} [deps.s3]   an S3 client (default: built from R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)
 * @param {Function} [deps.presigner]    getSignedUrl(client, command, {expiresIn})
 * @param {Function} [deps.openClip]     coach-disagreement-clip.js openClip
 * @param {object} [deps.sdk]            { S3Client, GetObjectCommand, HeadObjectCommand } (default @aws-sdk/client-s3)
 * @param {object} [deps.env]            process.env
 */
function createClipService(deps = {}) {
  const env = deps.env || process.env;
  let sdk = deps.sdk || null;
  let client = deps.s3 || null;
  const getSdk = () => sdk || (sdk = require('@aws-sdk/client-s3'));
  function getClient() {
    if (client) return client;
    const { S3Client } = getSdk();
    client = new S3Client({
      region: 'auto',
      endpoint: env.R2_ENDPOINT,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    });
    return client;
  }
  const getSignedUrl = deps.presigner || ((...a) => require('@aws-sdk/s3-request-presigner').getSignedUrl(...a));
  const openClip = deps.openClip || ((...a) => require('./coach-disagreement-clip').openClip(...a));

  /** m-insights writes the pre-cut clips here (COACHIP_CLIP_BUCKET, else the house bucket). */
  const clipBucket = () => env.COACHIP_CLIP_BUCKET || env.R2_BUCKET_NAME || null;

  /** coachip/full/<env>/<sessionId>.mp3 — the nightly whole-lesson MP3 (API.md §10 R8 seek caveat); null off a known env. */
  const fullAudioKey = (sessionId) => (FULL_ENVS.has(env.COACHIP_ENV) ? `coachip/full/${env.COACHIP_ENV}/${sessionId}.mp3` : null);

  /** { bucket, key } of an R2 URL https://<r2 host>/<bucket>/<key> (the bot's r2.js form); null for anything else. */
  function recordingLocation(audioUrl) {
    if (typeof audioUrl !== 'string' || !isValidR2Url(audioUrl)) return null;
    let u;
    try { u = new URL(audioUrl); } catch (_) { return null; }
    if (u.protocol !== 'https:') return null;
    // isValidR2Url is a substring test; the host itself must be R2's (or the configured endpoint's).
    let endpointHost = null;
    try { endpointHost = env.R2_ENDPOINT ? new URL(env.R2_ENDPOINT).host : null; } catch (_) { /* unset or malformed */ }
    if (!(u.host.endsWith('.r2.cloudflarestorage.com') || u.host.endsWith('.r2.dev') || u.host === endpointHost)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const dec = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } };
    return { bucket: dec(parts[0]), key: parts.slice(1).map(dec).join('/') };
  }

  async function presign({ bucket, key }) {
    const { GetObjectCommand } = getSdk();
    return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: PRESIGN_TTL_S });
  }

  /**
   * Pipe one object. Resolves 'served' (an answer was written), 'missing' (no such object; nothing written, so the
   * caller may fall back) or 'failed' (any other R2 error; nothing written).
   * contentType: a string, or (storedType) => string for an object whose type the store knows best.
   */
  async function streamObject(req, res, { bucket, key, contentType }) {
    const { GetObjectCommand, HeadObjectCommand } = getSdk();
    const range = rangeOf(req.headers && req.headers.range);
    let out;
    try {
      out = await getClient().send(new GetObjectCommand({ Bucket: bucket, Key: key, ...(range ? { Range: range } : {}) }));
    } catch (err) {
      if (isMissing(err)) return 'missing';
      if (!(range && isBadRange(err))) { logFailure('object read', err); return 'failed'; }
      // 416: the size comes from a HeadObject, so the player learns how long the object is (RFC 9110 §15.5.17).
      let size;
      try {
        size = (await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).ContentLength;
      } catch (headErr) {
        if (isMissing(headErr)) return 'missing';
        logFailure('object size', headErr);
        return 'failed';
      }
      const type = typeof contentType === 'function' ? contentType(null) : contentType;
      res.status(416).set({ ...audioHeaders(type), 'Content-Range': `bytes */${Number(size) || 0}` });
      res.end();
      return 'served';
    }
    const body = out.Body;
    const type = typeof contentType === 'function' ? contentType(out.ContentType) : contentType;
    const partial = !!(range && out.ContentRange);
    const headers = { ...audioHeaders(type), 'Accept-Ranges': 'bytes' };
    if (partial) headers['Content-Range'] = out.ContentRange;
    if (Number.isFinite(out.ContentLength)) headers['Content-Length'] = String(out.ContentLength);
    res.status(partial ? 206 : 200).set(headers);
    res.on('close', () => { if (!res.writableFinished && body && typeof body.destroy === 'function') body.destroy(); });
    if (!body || typeof body.pipe !== 'function') { res.end(); return 'served'; }
    body.on('error', (err) => { logFailure('object stream', err); res.destroy(); });
    body.pipe(res);
    return 'served';
  }

  /**
   * The live ffmpeg cut of [fromS, toS] of the recording (API.md §10 R7.3): first byte within openClip's own 20 s, then
   * 200 audio/mpeg with no length and no ranges. Resolves 'served', or 'failed' with nothing written.
   */
  async function liveCut(req, res, { audioUrl, fromS, toS }) {
    const loc = recordingLocation(audioUrl);
    if (!loc) return 'failed';
    let url;
    try { url = await presign(loc); } catch (err) { logFailure('presign', err); return 'failed'; }
    let clip;
    try { clip = await openClip(url, fromS, { to: toS }); } catch (err) { logFailure('live cut', err); return 'failed'; }
    res.status(200).set({ ...audioHeaders('audio/mpeg'), 'Accept-Ranges': 'none' });
    res.write(clip.first);
    res.on('close', () => { if (!res.writableFinished) { try { clip.proc.kill('SIGKILL'); } catch (_) { /* gone */ } } });
    clip.stream.on('error', () => res.end());
    clip.stream.pipe(res);
    clip.stream.resume();
    return 'served';
  }

  return { presign, clipBucket, fullAudioKey, recordingLocation, streamObject, liveCut, audioTypeFor };
}

module.exports = { createClipService, PRESIGN_TTL_S, audioTypeFor, rangeOf };
