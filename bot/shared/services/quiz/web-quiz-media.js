'use strict';
/**
 * Web quiz media links: short-lived presigned GETs for the page.
 *
 * Read-only: signs links to objects already in R2 and HEADs them; it never
 * writes. Never throws — a link it cannot make is null, and the page falls
 * back (the phone's own voice for read-aloud, no video panel for video).
 */

const r2 = require('../../storage/r2');
const { bucketForKey } = require('./web-quiz-audio-store');
const { logWarn } = require('../../utils/logger');

const DEFAULT_EXPIRES = 6 * 60 * 60; // 6 h, the life of the quiz payload

async function sign(key, expiresIn) {
  if (!key) return null;
  try {
    const url = await r2.getPresignedUrl(r2.buildR2PublicUrl(key), expiresIn);
    return url && url.includes('X-Amz-Signature') ? url : null;
  } catch (_) {
    return null;
  }
}

// A read-aloud clip, signed for the bucket it was recorded in (the quiz says which; legacy keys
// live in the default bucket), by key — so a quiz recorded into another bucket still plays.
async function signClip(key, meta, expiresIn) {
  if (!key) return null;
  try {
    const url = await r2.presignKey(key, expiresIn, { bucket: bucketForKey(key, meta) });
    return url && url.includes('X-Amz-Signature') ? url : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {object} meta  quizzes.meta
 * @returns {Promise<Object<string, {q: string|null, opts: Array<string|null>, why: string|null, fbs?: Array<string|null>, hint?: string|null}>>}
 */
async function presignAudio(meta, { expiresIn = DEFAULT_EXPIRES } = {}) {
  const audio = meta && meta.web && meta.web.audio;
  if (!audio || typeof audio !== 'object') return {};
  const out = {};
  await Promise.all(Object.entries(audio).map(async ([qid, entry]) => {
    if (!entry || typeof entry !== 'object') return;
    const [q, why, opts, fbs, hint] = await Promise.all([
      signClip(entry.q, meta, expiresIn),
      signClip(entry.why, meta, expiresIn),
      Promise.all((Array.isArray(entry.opts) ? entry.opts : []).map((k) => signClip(k, meta, expiresIn))),
      Promise.all((Array.isArray(entry.fbs) ? entry.fbs : []).map((k) => signClip(k, meta, expiresIn))),
      signClip(entry.hint, meta, expiresIn),
    ]);
    const one = fbs.some(Boolean) ? { q, opts, why, fbs } : { q, opts, why };
    out[qid] = hint ? { ...one, hint } : one;
  }));
  return out;
}

async function head(key) {
  try {
    return await r2.headObject(key);
  } catch (_) {
    return { exists: false };
  }
}

/**
 * The R2 key of a video-bank row. The rows hold path-style URLs naming the
 * bucket they were migrated into; a deployment with a different bucket on the
 * same R2 endpoint keeps the same keys, so the key is the path after the
 * bucket segment. Any other host is not ours to sign.
 * @returns {{key: string, foreign: boolean}}
 */
function videoKey(r2Url) {
  try {
    return { key: r2.extractKeyFromUrl(r2Url), foreign: false };
  } catch (error) {
    const m = /^https?:\/\/([^/]+)\/[^/]+\/(.+)$/i.exec(String(r2Url).split('?')[0]);
    const ours = /^https?:\/\/([^/]+)/i.exec(process.env.R2_ENDPOINT || '');
    if (!m || !ours || m[1].toLowerCase() !== ours[1].toLowerCase()) throw error;
    return { key: m[2], foreign: true };
  }
}

/**
 * @param {{video_id?: string}} quiz
 * @param {{db?: object, expiresIn?: number}} [opts]
 * @returns {Promise<{url: string, poster?: string, bytes?: number, secs?: number} | null>}
 */
async function presignVideo(quiz, { db, expiresIn = DEFAULT_EXPIRES } = {}) {
  if (!quiz || !quiz.video_id) return null;
  try {
    const client = db || require('../../config/supabase');
    const { data: row } = await client.from('student_videos')
      .select('id, r2_url, migration_status').eq('id', quiz.video_id).maybeSingle();
    if (!row || row.migration_status !== 'done' || !row.r2_url) return null;

    const { key, foreign } = videoKey(row.r2_url);
    // The page prefers a lighter web copy beside the original (<key>_web.mp4: the same video
    // stream, the audio re-encoded smaller). WhatsApp keeps sending the original.
    const webKey = key.replace(/\.[a-z0-9]+$/i, '_web.mp4');
    const [video, poster, web] = await Promise.all([
      head(key),
      head(key.replace(/\.[a-z0-9]+$/i, '_poster.jpg')),
      webKey !== key ? head(webKey) : Promise.resolve({ exists: false }),
    ]);
    // A row naming another bucket is served only from a copy we hold.
    if (foreign && !video.exists && !web.exists) throw new Error(`video not in this bucket: ${key}`);
    const url = await sign(web.exists ? webKey : key, expiresIn);
    if (!url) return null;
    const out = { url };
    const chosen = web.exists ? web : video;
    if (chosen.exists && chosen.sizeBytes) out.bytes = chosen.sizeBytes;
    if (poster.exists) {
      const p = await sign(key.replace(/\.[a-z0-9]+$/i, '_poster.jpg'), expiresIn);
      if (p) out.poster = p;
    }
    return out;
  } catch (error) {
    logWarn('web_quiz.presign_video.failed', { quizId: quiz.id, error: String(error.message || error).slice(0, 200) });
    return null;
  }
}

// Poster links, signed once and reused for half their life: signing is local work, but the
// library asks for the same posters over and over.
const posterCache = new Map();
const POSTER_CACHE_MAX = 3000;

/**
 * A signed link to a video's poster (<key>_poster.jpg beside the video), WITHOUT asking R2 whether
 * it exists: signing is local computation, and the page falls back to the subject's tile when the
 * picture does not load. Null when the row's URL is not ours to sign.
 * @param {string} r2Url  student_videos.r2_url
 */
async function signPoster(r2Url, { expiresIn = DEFAULT_EXPIRES } = {}) {
  if (!r2Url) return null;
  let key;
  try { key = videoKey(r2Url).key.replace(/\.[a-z0-9]+$/i, '_poster.jpg'); } catch (_) { return null; }
  const hit = posterCache.get(key);
  if (hit && Date.now() - hit.at < (expiresIn * 1000) / 2) return hit.url;
  let url = null;
  try { url = await r2.getPresignedGetUrl(key, expiresIn); } catch (_) { url = null; }
  if (url && !url.includes('X-Amz-Signature')) url = null;
  if (url) {
    if (posterCache.size >= POSTER_CACHE_MAX) posterCache.clear();
    posterCache.set(key, { at: Date.now(), url });
  }
  return url;
}

/**
 * A link that SAVES a bank video (Content-Disposition: attachment) under `filename`: the light web
 * copy when one exists beside the original, else the original. Null when neither is ours.
 * @param {string} r2Url  student_videos.r2_url
 */
async function presignDownload(r2Url, filename, { expiresIn = 3600 } = {}) {
  try {
    const { key, foreign } = videoKey(r2Url);
    const webKey = key.replace(/\.[a-z0-9]+$/i, '_web.mp4');
    const web = webKey !== key ? await head(webKey) : { exists: false };
    if (!web.exists && foreign && !(await head(key)).exists) return null;
    const url = await r2.getPresignedUrl(r2.buildR2PublicUrl(web.exists ? webKey : key), expiresIn, { disposition: 'attachment', filename });
    return url && url.includes('X-Amz-Signature') ? url : null;
  } catch (_) {
    return null;
  }
}

module.exports = { presignAudio, presignVideo, signPoster, presignDownload, videoKey, DEFAULT_EXPIRES, _posterCache: posterCache };
