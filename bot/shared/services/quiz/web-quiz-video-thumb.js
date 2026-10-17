'use strict';
/**
 * A lesson's small thumbnail for the Videos door's picture shelves (app_settings web_quiz_video_shelf, default off):
 *   thumb(vid) -> { bytes, contentType: 'image/webp' } | null
 * The lesson's own poster (student-videos/<file>_poster.jpg beside the video) shrunk once to 320 × 180 WebP (two times a
 * 160 px card), at most MAX_BYTES, and kept in memory; the edge keeps it too, so a phone's second visit and the next
 * child's never reach here. Only a lesson the library lists (the bank) has one; nothing is written to storage.
 * Null when the switch is off, the lesson is not in the bank, it has no poster, or anything fails (the page then shows
 * the full poster, then a plain tile).
 */
const { logToFile } = require('../../utils/logger');

// Bump when the drawing changes (size, quality): the shelf's URLs carry it, so a phone's year-long cache never goes stale.
// A new poster is a new lesson row (student_videos.superseded_by), so a new id and a new URL.
const VERSION = '1';
const W = 320;
const H = 180;
const MAX_BYTES = 20 * 1024;
const QUALITIES = [55, 40, 28];
const KEEP_MAX = 600;
const kept = new Map();       // vid -> { bytes, contentType }
const inFlight = new Map();   // vid -> Promise

async function draw(vid) {
  const VID_RX = require('./web-quiz-videos').VID_RX;
  if (!VID_RX.test(String(vid || ''))) return null;
  const ix = await require('./web-quiz-bank').bank();
  const row = ix && ix.rows.find((r) => r.id === vid);
  if (!row || !row.r2_url) return null;
  const key = require('./web-quiz-media').videoKey(row.r2_url).key.replace(/\.[a-z0-9]+$/i, '_poster.jpg');
  const poster = await require('../../storage/r2').downloadFromR2(key);
  if (!poster || !poster.length) return null;
  const sharp = require('sharp');
  const img = sharp(poster).rotate().resize(W, H, { fit: 'cover', position: 'attention' });
  let bytes = null;
  for (const q of QUALITIES) {
    bytes = await img.clone().webp({ quality: q, effort: 4 }).toBuffer();
    if (bytes.length <= MAX_BYTES) break;
  }
  return bytes && bytes.length <= MAX_BYTES ? { bytes, contentType: 'image/webp' } : null;
}

async function thumb(vid) {
  if (!(await require('./web-quiz-library-flag').videoShelfOn())) return null;
  const id = String(vid || '').toLowerCase();
  if (kept.has(id)) return kept.get(id);
  if (inFlight.has(id)) return inFlight.get(id);
  const p = draw(id).then((pic) => {
    if (pic) {
      if (kept.size >= KEEP_MAX) kept.delete(kept.keys().next().value);
      kept.set(id, pic);
    }
    return pic;
  }, (err) => {
    logToFile('⚠️ web quiz video thumb: not drawn', { error: err.message });
    return null;
  }).finally(() => inFlight.delete(id));
  inFlight.set(id, p);
  return p;
}

module.exports = { thumb, VERSION, W, H, MAX_BYTES, _reset: () => { kept.clear(); inFlight.clear(); } };
