'use strict';
/**
 * P1.2 — persist + resolve the prescribed move-lists (the fidelity denominator).
 *
 * Store: table `niete_lp_fidelity_moves`, one row per corpus LP VERSION, keyed by
 * (lesson_id, version_stamp, content_hash) — identical to niete_lp_assets. The backfill upserts the
 * offline-extracted lists; the runtime resolver fetches the moves for the EXACT version the teacher
 * downloaded (from niete_lp_downloads), never "latest" — so fidelity is scored against the LP she was
 * actually given. Uploaded-LP move-lists are per-session and are NOT stored here (handled at P1.3/P3.3).
 *
 * The supabase client is injectable (opts.client) so unit tests never touch a real DB.
 * Refs: bd-wmfsp.3.
 */

const TABLE = 'niete_lp_fidelity_moves';

function client(opts = {}) {
  return opts.client || require('../../../config/supabase');
}

/**
 * Resolve the prescribed move-list for the LP version a coaching session used.
 * @param {{lesson_id:string, version_stamp?:string, content_hash?:string}} key
 * @param {{client?:object, fallbackToCurrent?:boolean}} opts
 * @returns {Promise<{lesson_id, version_stamp, content_hash, template, moves, resolved:'exact'|'current'}|null>}
 */
async function resolveMoveList(key, opts = {}) {
  if (!key || !key.lesson_id) return null;
  const sb = client(opts);

  // 1) exact version the teacher downloaded
  if (key.version_stamp || key.content_hash) {
    let q = sb.from(TABLE)
      .select('lesson_id, version_stamp, content_hash, template, total_minutes, moves')
      .eq('lesson_id', key.lesson_id);
    if (key.version_stamp) q = q.eq('version_stamp', key.version_stamp);
    if (key.content_hash) q = q.eq('content_hash', key.content_hash);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    if (data) return { ...data, resolved: 'exact' };
  }

  // 2) optional fallback: the newest row for this lesson (a teacher on an older version still gets
  //    scored, flagged 'current' so the caller can note the version drift). OFF by default.
  if (opts.fallbackToCurrent) {
    const { data, error } = await sb.from(TABLE)
      .select('lesson_id, version_stamp, content_hash, template, total_minutes, moves')
      .eq('lesson_id', key.lesson_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return { ...data, resolved: 'current' };
  }

  return null; // unknown lesson/version → caller treats as lp_absent (never throws)
}

/**
 * Upsert one move-list (backfill / ingest). Keyed by the UNIQUE (lesson_id, version_stamp, content_hash).
 * @param {object} row  { lesson_id, catalog_version, version_stamp, content_hash, brief_sha, template,
 *                        total_minutes, moves, n_moves, model }
 */
async function upsertMoveList(row, opts = {}) {
  const sb = client(opts);
  const payload = { ...row, updated_at: new Date().toISOString() };
  const { data, error } = await sb.from(TABLE)
    .upsert(payload, { onConflict: 'lesson_id,version_stamp,content_hash' })
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = { resolveMoveList, upsertMoveList, TABLE };
