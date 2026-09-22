'use strict';
/**
 * PLAN R8 §2.2 — the slide script of the EXACT lesson version a teacher was served.
 *
 * Store: table `niete_lp_asset_sources` (migration V1.5.2), one row per LP asset,
 * keyed by (lesson_id, version_stamp, content_hash) — the same version triple
 * `niete_lp_assets` and `niete_lp_fidelity_moves` carry.
 *
 * `resolveSlideScript` is EXACT-VERSION ONLY. There is deliberately no "latest for
 * this lesson" fallback: a hash mismatch means the teacher is holding a different
 * PDF from the one we hold the script for, and a quiz written from the newer script
 * would ask about a page that is not in their hand. The caller (lane D) turns the
 * null into the `source_missing` failure instead.
 *
 * Why the slide script and not the enrichment: measured over the 1,211 lessons taken
 * in the week to 22 Sep 2026, the published slide script matched the served PDF on
 * 50/50 OCR'd lessons, while the stable-path enrichment was stale for 79% of them.
 *
 * Writers: `bot/scripts/upload-lp-v8-to-r2.js` (verified 'upload', in the same run
 * that inserts the asset row) and `bot/scripts/backfill-lp-asset-sources.js`
 * (verified 'backfill:link', gated on the matrix LP link being the served object).
 *
 * The supabase client is injectable (opts.client) so unit tests never touch a DB.
 */

const TABLE = 'niete_lp_asset_sources';

/** Every provenance value the `verified` column may carry. */
const VERIFIED = Object.freeze({
  UPLOAD: 'upload',
  BACKFILL_LINK: 'backfill:link',
  BACKFILL_LINK_OCR: 'backfill:link+ocr',
});

/** Columns an upsert must carry; a row missing any of them is not storable. */
const REQUIRED = ['asset_id', 'lesson_id', 'version_stamp', 'content_hash', 'slide_script', 'verified'];

function client(opts = {}) {
  return opts.client || require('../../config/supabase');
}

/**
 * Resolve the slide script for the LP version a teacher actually holds.
 *
 * @param {{lessonId:string, versionStamp?:string, contentHash?:string}} key
 * @param {{client?:object}} opts
 * @returns {Promise<{slideScript:object, verified:string, assetId:string}|null>}
 *   null when no row matches that exact version. Throws on a DB error — an error
 *   must never be mistaken for "this lesson has no source".
 */
async function resolveSlideScript(key, opts = {}) {
  const lessonId = key && key.lessonId;
  const versionStamp = key && key.versionStamp;
  const contentHash = key && key.contentHash;

  // No version identity means no exact answer. Returning the lesson's newest row
  // here is exactly the "latest" fallback this store exists to refuse.
  if (!lessonId || (!versionStamp && !contentHash)) return null;

  let q = client(opts)
    .from(TABLE)
    .select('asset_id, lesson_id, version_stamp, content_hash, slide_script, source_url, verified')
    .eq('lesson_id', lessonId);
  if (versionStamp) q = q.eq('version_stamp', versionStamp);
  if (contentHash) q = q.eq('content_hash', contentHash);

  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`${TABLE}: ${error.message || error}`);
  if (!data) return null;

  return { slideScript: data.slide_script, verified: data.verified, assetId: data.asset_id };
}

/**
 * Ingest one slide script. Upserts on the UNIQUE version key, so re-running the
 * uploader or the backfill rewrites the row rather than making a second one the
 * resolver would then pick between at random.
 *
 * @param {{asset_id:string, lesson_id:string, version_stamp:string, content_hash:string,
 *          slide_script:object, source_url?:string|null, verified:string}} row
 */
async function upsertSource(row, opts = {}) {
  const missing = REQUIRED.filter((f) => row == null || row[f] === undefined || row[f] === null || row[f] === '');
  if (missing.length) throw new Error(`${TABLE}: refusing to upsert, missing ${missing.join(', ')}`);

  const payload = {
    asset_id: row.asset_id,
    lesson_id: row.lesson_id,
    version_stamp: row.version_stamp,
    content_hash: row.content_hash,
    slide_script: row.slide_script,
    source_url: row.source_url === undefined ? null : row.source_url,
    verified: row.verified,
    ingested_at: new Date().toISOString(),
  };

  const { data, error } = await client(opts)
    .from(TABLE)
    .upsert(payload, { onConflict: 'lesson_id,version_stamp,content_hash' })
    .select('asset_id')
    .maybeSingle();
  if (error) throw new Error(`${TABLE}: ${error.message || error}`);
  return data;
}

module.exports = { resolveSlideScript, upsertSource, TABLE, VERIFIED, REQUIRED };
