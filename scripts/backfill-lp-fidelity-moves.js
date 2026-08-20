#!/usr/bin/env node
'use strict';
/**
 * Backfill niete_lp_fidelity_moves from the offline-extracted move-lists (bd-wmfsp.3, P1.2).
 *
 * For each `<lesson_id>.moves.json`, join niete_lp_assets (asset_kind='lesson', is_current) to get the
 * version_stamp + content_hash + catalog_version of the LP version currently served, then upsert the
 * move-list keyed by (lesson_id, version_stamp, content_hash).
 *
 * ⚠️ PROD WRITE — needs an explicit operator "go" (root CLAUDE.md Rule 7) and runs against the NIETE DB.
 * Safety (bd-2536): asserts the Supabase project ref is NIETE before writing; --dry-run makes no writes.
 *
 * Usage:
 *   MOVES_DIR=/path/to/out/v8/lesson-plan-script node scripts/backfill-lp-fidelity-moves.js --dry-run
 *   MOVES_DIR=... node scripts/backfill-lp-fidelity-moves.js            # writes (after a go)
 */
const fs = require('fs');
const path = require('path');

const EXPECTED_REF = 'ihzciabopbttygxxgrkm'; // NIETE prod Supabase project ref
const DRY = process.argv.includes('--dry-run');
const MOVES_DIR = process.env.MOVES_DIR;

function assertNieteDb() {
  const url = process.env.SUPABASE_URL || process.env.NIETE_SUPABASE_URL || '';
  const ref = (url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
  if (ref !== EXPECTED_REF) {
    throw new Error(`REFUSING TO WRITE: SUPABASE_URL ref='${ref}' is not NIETE ('${EXPECTED_REF}'). ` +
      `A worktree seeded with the main-bot .env points at the WRONG prod DB (bd-2536). Fix .env first.`);
  }
}

async function main() {
  if (!MOVES_DIR) throw new Error('set MOVES_DIR to the dir of <lesson_id>.moves.json files');
  assertNieteDb();
  const supabase = require('../bot/shared/config/supabase');
  const { upsertMoveList } = require('../bot/shared/services/coaching/fidelity/lp-fidelity-store');

  const files = fs.readdirSync(MOVES_DIR).filter((f) => f.endsWith('.moves.json'));
  console.log(`${files.length} move-lists in ${MOVES_DIR}  ${DRY ? '(DRY RUN — no writes)' : '(WRITING)'}`);

  let ok = 0, noAsset = 0, failed = 0;
  for (const f of files) {
    const ext = JSON.parse(fs.readFileSync(path.join(MOVES_DIR, f), 'utf8'));
    const lessonId = ext.lesson_id;
    // find the currently-served LP asset version for this lesson
    const { data: asset, error } = await supabase
      .from('niete_lp_assets')
      .select('catalog_version, version_stamp, content_hash')
      .eq('lesson_id', lessonId).eq('asset_kind', 'lesson').eq('is_current', true)
      .maybeSingle();
    if (error) { console.error(`  ${lessonId}: asset query error`, error.message); failed++; continue; }
    if (!asset) { noAsset++; continue; } // no served asset → nothing to key against yet
    const row = {
      lesson_id: lessonId,
      catalog_version: asset.catalog_version,
      version_stamp: asset.version_stamp,
      content_hash: asset.content_hash,
      brief_sha: ext.brief_sha,
      template: ext.template,
      total_minutes: ext.total_minutes,
      moves: ext.moves,
      n_moves: (ext.moves || []).length,
      model: ext.model,
    };
    if (DRY) { ok++; continue; }
    try { await upsertMoveList(row); ok++; }
    catch (e) { console.error(`  ${lessonId}: upsert failed`, e.message); failed++; }
  }
  console.log(`done: ${ok} upserted, ${noAsset} skipped (no served asset), ${failed} failed`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
