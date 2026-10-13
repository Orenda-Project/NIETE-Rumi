'use strict';
/**
 * P2 — the recent-LP source for the coaching selection list (D25).
 *
 * Reads the teacher's niete_lp_downloads (dedup by lesson_id, most-recent-first), enriches each lesson
 * via the V8 catalog (topic / day_label / pages_label / chapter title), and returns rows that carry the
 * (lesson_id, version_stamp, content_hash) keys the fidelity resolver needs. The row `id` is the
 * download's asset_id — it becomes the selection id (lp_select_{asset_id}_{sessionId}), which the linker
 * resolves back to the version keys on select. Sourcing from downloads (not lesson_plans) is what lets
 * one query serve both the richer label AND fidelity resolution. Refs: bd-wmfsp.5.
 *
 * PLANS READ IN THE APP. Since 12 Oct 2026 most K-5 plans are read in the teacher app, which writes
 * niete_lp_opens and no download row, so a downloads-only list offered her stale plans or none. Her
 * app VIEWER opens are merged in through lp-app-opens.store (the one app-open reader: viewer opens
 * only, each shaped as a download of the asset the app served her at the open), newest use first,
 * one row per lesson. Kill switch COACHING_ASK_COUNT_APP_OPENS=off → downloads only (the
 * store's quiz switch does not apply: this list has its own). A failed app-open read lists her downloads and says so
 * at error level: a shorter list beats no list at the moment she has just recorded.
 */

const { logToFile } = require('../../../utils/logger');
const { onUnlessOff } = require('../../nudges/flags');

/** How far back her app opens are read, and at most how many — the list shows 8. */
const APP_OPENS_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const APP_OPENS_MAX = 50;

async function appOpenRows(userId, opts) {
  if (!onUnlessOff('COACHING_ASK_COUNT_APP_OPENS')) return [];
  const read = opts.appOpens
    || ((id, since, max) => require('../../quiz/lp-app-opens.store').teacherViewerOpens(id, since, max));
  const now = opts.now ? new Date(opts.now) : new Date();
  try {
    return (await read(userId, new Date(now.getTime() - APP_OPENS_LOOKBACK_MS).toISOString(), APP_OPENS_MAX)) || [];
  } catch (err) {
    logToFile('❌ recent LPs: app opens unreadable — listing WhatsApp deliveries only', { userId, error: err && err.message }, 'error');
    return [];
  }
}

async function getRecentFidelityLps(userId, opts = {}) {
  const sb = opts.client || require('../../../config/supabase');
  const lessonById = opts.lessonById || require('../../lp-v8-catalog.service').lessonById;
  // bd-zrlcp — matches the LP-selection list's row budget (8 = WhatsApp's
  // 10-row list cap minus the 2 Options rows). Fetching more than the surface
  // can render only wastes catalogue lookups.
  const limit = opts.limit || 8;

  const { data, error } = await sb
    .from('niete_lp_downloads')
    .select('asset_id, lesson_id, version_stamp, content_hash, grade, subject, chapter_number, created_at')
    .eq('user_id', userId)
    .eq('status', 'sent')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const used = [...(data || []), ...(await appOpenRows(userId, opts))]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const seen = new Set();
  const rows = [];
  for (const d of used) {
    if (!d.lesson_id || seen.has(d.lesson_id)) continue; // dedup re-downloads, keep the most recent
    seen.add(d.lesson_id);
    let cat = null;
    try { cat = lessonById(d.lesson_id); } catch (_) { cat = null; }
    const lesson = cat && cat.lesson;
    const chapter = cat && cat.chapter;
    rows.push({
      id: d.asset_id,                 // → selection id lp_select_{asset_id}_{sessionId}
      asset_id: d.asset_id,
      lesson_id: d.lesson_id,
      version_stamp: d.version_stamp,
      content_hash: d.content_hash,
      topic: (lesson && (lesson.topic || lesson.topic_short)) || null,
      grade: d.grade,
      subject: d.subject,
      chapter_number: d.chapter_number != null ? d.chapter_number : (chapter ? chapter.number : null),
      day_label: (lesson && lesson.day_label) || null,
      pages_label: (lesson && lesson.pages_label) || null,
      created_at: d.created_at,
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

module.exports = { getRecentFidelityLps };
