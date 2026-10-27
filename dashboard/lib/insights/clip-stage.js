'use strict';
/**
 * Stage 11 wired to R2 (write mode only, on the asserted tier): for each shown moment that needs a cut, presign the
 * source recording for 300 s (server → R2 only; never stored or logged), cut with clips.cutAndUpload into the
 * environment's clip bucket, and set clip_status / clip_r2_key. A failure is `failed` (the route plays the full recording
 * from lesson_s and says so); it is retried the next night. Then the whole lesson as one seekable MP3 per session with a
 * shown moment (clips.cutFullAndUpload), skipped when the object is already there, so a second night uploads nothing.
 * The full stage logs counts only.
 */
const os = require('os');
const { clipKey, cutAndUpload, planClips, fullKey, cutFullAndUpload } = require('./clips');

const PRESIGN_S = 300;
const FULL_PRESIGN_S = 900;

/** Path-style `/<bucket>/<key…>` or a full URL with that path → { bucket, key }. */
function sourceOf(audioUrl) {
  if (typeof audioUrl !== 'string' || !audioUrl) return null;
  let p = audioUrl;
  try { if (/^https?:/i.test(audioUrl)) p = new URL(audioUrl).pathname; } catch (_) { return null; }
  const parts = p.replace(/^\/+/, '').split('/');
  if (parts.length < 2 || !parts[0]) return null;
  return { bucket: parts[0], key: decodeURIComponent(parts.slice(1).join('/')) };
}

function createClipper({ envName, bucket, s3, presign, tmpDir = os.tmpdir(), spawn, bin }) {
  return async function clipper({ momentIds, moments, facts, audioOf, store, log }) {
    const factById = new Map(facts.map((f) => [f.id, f]));
    let ready = 0;
    for (const m of planClips(moments, momentIds)) {
      const f = factById.get(m.fact_id);
      const src = sourceOf(audioOf.get(m.session_id));
      let status = 'failed';
      let key = null;
      if (f && src) {
        try {
          key = clipKey(envName, m.session_id, m.from_s, m.to_s);
          const srcUrl = await presign(s3, src, PRESIGN_S);
          status = await cutAndUpload({ srcUrl, fromS: m.from_s, toS: m.to_s, key,
            deps: { tmpDir, bucket, spawn, bin, putObject: (o) => s3.putObject(o), log: (e) => log && log(e) } });
        } catch (_) { status = 'failed'; }
      }
      await store.update('coachip_moments', m.id, { clip_status: status, clip_r2_key: status === 'ready' ? key : null });
      if (status === 'ready') ready += 1;
    }
    await cutFull({ momentIds, moments, audioOf, log });
    return ready;
  };

  async function exists(key) {
    if (!s3.headObject) return false;
    try { await s3.headObject({ Bucket: bucket, Key: key }); return true; } catch (_) { return false; }
  }

  async function cutFull({ momentIds, moments, audioOf, log }) {
    const shown = new Set(momentIds || []);
    const sessions = [...new Set((moments || []).filter((m) => m && shown.has(m.id)).map((m) => m.session_id))];
    const n = { ready: 0, skipped: 0, failed: 0 };
    for (const sessionId of sessions) {
      let status = 'failed';
      try {
        const key = fullKey(envName, sessionId);
        const src = sourceOf(audioOf.get(sessionId));
        if (await exists(key)) status = 'skipped';
        else if (src) {
          const srcUrl = await presign(s3, src, FULL_PRESIGN_S);
          status = await cutFullAndUpload({ srcUrl, key, deps: { tmpDir, bucket, spawn, bin, putObject: (o) => s3.putObject(o) } });
        }
      } catch (_) { status = 'failed'; }
      n[status] += 1;
    }
    if (log) log(`full ready=${n.ready} skipped=${n.skipped} failed=${n.failed}`);
  }
}

/** The real R2 wiring from the portal service's env (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY). */
function r2FromEnv(env) {
  const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const client = new S3Client({ region: 'auto', endpoint: env.R2_ENDPOINT,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
  return {
    s3: { putObject: (o) => client.send(new PutObjectCommand(o)), headObject: (o) => client.send(new HeadObjectCommand(o)) },
    presign: (_s3, src, seconds) => getSignedUrl(client, new GetObjectCommand({ Bucket: src.bucket, Key: src.key }), { expiresIn: seconds }),
  };
}

module.exports = { createClipper, sourceOf, r2FromEnv, PRESIGN_S, FULL_PRESIGN_S };
