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
 */

async function getRecentFidelityLps(userId, opts = {}) {
  const sb = opts.client || require('../../../config/supabase');
  const lessonById = opts.lessonById || require('../../lp-v8-catalog.service').lessonById;
  const limit = opts.limit || 15;

  const { data, error } = await sb
    .from('niete_lp_downloads')
    .select('asset_id, lesson_id, version_stamp, content_hash, grade, subject, chapter_number, created_at')
    .eq('user_id', userId)
    .eq('status', 'sent')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const seen = new Set();
  const rows = [];
  for (const d of data || []) {
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
