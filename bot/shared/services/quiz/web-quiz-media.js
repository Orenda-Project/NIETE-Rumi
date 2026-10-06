'use strict';
/**
 * Web quiz media links: short-lived presigned GETs for the page.
 *
 * Read-only: signs links to objects already in R2 and HEADs them; it never
 * writes. Never throws — a link it cannot make is null, and the page falls
 * back (the phone's own voice for read-aloud, no video panel for video).
 */

const r2 = require('../../storage/r2');
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

/**
 * @param {object} meta  quizzes.meta
 * @returns {Promise<Object<string, {q: string|null, opts: Array<string|null>, why: string|null, fbs?: Array<string|null>}>>}
 */
async function presignAudio(meta, { expiresIn = DEFAULT_EXPIRES } = {}) {
  const audio = meta && meta.web && meta.web.audio;
  if (!audio || typeof audio !== 'object') return {};
  const out = {};
  await Promise.all(Object.entries(audio).map(async ([qid, entry]) => {
    if (!entry || typeof entry !== 'object') return;
    const [q, why, opts, fbs, hint] = await Promise.all([
      sign(entry.q, expiresIn),
      sign(entry.why, expiresIn),
      Promise.all((Array.isArray(entry.opts) ? entry.opts : []).map((k) => sign(k, expiresIn))),
      Promise.all((Array.isArray(entry.fbs) ? entry.fbs : []).map((k) => sign(k, expiresIn))),
      sign(entry.hint, expiresIn),
    ]);
    out[qid] = fbs.some(Boolean) ? { q, opts, why, fbs } : { q, opts, why };
    if (hint) out[qid].hint = hint;
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

module.exports = { presignAudio, presignVideo, DEFAULT_EXPIRES };
