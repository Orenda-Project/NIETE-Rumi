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
 * @returns {Promise<Object<string, {q: string|null, opts: Array<string|null>, why: string|null}>>}
 */
async function presignAudio(meta, { expiresIn = DEFAULT_EXPIRES } = {}) {
  const audio = meta && meta.web && meta.web.audio;
  if (!audio || typeof audio !== 'object') return {};
  const out = {};
  await Promise.all(Object.entries(audio).map(async ([qid, entry]) => {
    if (!entry || typeof entry !== 'object') return;
    const [q, why, opts] = await Promise.all([
      sign(entry.q, expiresIn),
      sign(entry.why, expiresIn),
      Promise.all((Array.isArray(entry.opts) ? entry.opts : []).map((k) => sign(k, expiresIn))),
    ]);
    out[qid] = { q, opts, why };
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

    const key = r2.extractKeyFromUrl(row.r2_url);
    const url = await sign(key, expiresIn);
    if (!url) return null;
    const out = { url };

    const [video, poster] = await Promise.all([
      head(key),
      head(key.replace(/\.[a-z0-9]+$/i, '_poster.jpg')),
    ]);
    if (video.exists && video.sizeBytes) out.bytes = video.sizeBytes;
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
