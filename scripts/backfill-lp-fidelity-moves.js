#!/usr/bin/env node
'use strict';
/**
 * Backfill niete_lp_fidelity_moves from the offline-extracted move-lists (bd-wmfsp.3, P1.2).
 *
 * Batched: read the CURRENT 'lesson' assets once (paged) → map lesson_id → version keys, then bulk-upsert
 * the move-lists in chunks. Keyed by (lesson_id, version_stamp, content_hash) identical to niete_lp_assets,
 * so a coaching session resolves the moves for the exact LP version the teacher downloaded.
 *
 * ⚠️ PROD WRITE — needs an explicit operator "go" (root CLAUDE.md Rule 7), runs against the NIETE DB.
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
const CHUNK = 400;

function assertNieteDb() {
  const url = process.env.SUPABASE_URL || process.env.NIETE_SUPABASE_URL || '';
  const ref = (url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
  if (ref !== EXPECTED_REF) {
    throw new Error(`REFUSING TO WRITE: SUPABASE_URL ref='${ref}' is not NIETE ('${EXPECTED_REF}'). ` +
      `A worktree seeded with the main-bot .env points at the WRONG prod DB (bd-2536). Fix .env first.`);
  }
}

async function loadAssetMap(supabase) {
  const map = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('niete_lp_assets')
      .select('lesson_id, catalog_version, version_stamp, content_hash')
      .eq('asset_kind', 'lesson').eq('is_current', true)
      .range(from, from + 999);
    if (error) throw error;
    for (const a of data) if (!map.has(a.lesson_id)) map.set(a.lesson_id, a);
    if (data.length < 1000) break;
  }
  return map;
}

async function main() {
  if (!MOVES_DIR) throw new Error('set MOVES_DIR to the dir of <lesson_id>.moves.json files');
  assertNieteDb();
  const supabase = require('../bot/shared/config/supabase');

  const assets = await loadAssetMap(supabase);
  console.log(`asset map: ${assets.size} current 'lesson' assets`);

  const files = fs.readdirSync(MOVES_DIR).filter((f) => f.endsWith('.moves.json'));
  const rows = [];
  let noAsset = 0;
  for (const f of files) {
    const ext = JSON.parse(fs.readFileSync(path.join(MOVES_DIR, f), 'utf8'));
    const a = assets.get(ext.lesson_id);
    if (!a) { noAsset++; continue; }
    rows.push({
      lesson_id: ext.lesson_id,
      catalog_version: a.catalog_version, version_stamp: a.version_stamp, content_hash: a.content_hash,
      brief_sha: ext.brief_sha, template: ext.template, total_minutes: ext.total_minutes,
      moves: ext.moves, n_moves: (ext.moves || []).length, model: ext.model,
      updated_at: new Date().toISOString(),
    });
  }
  console.log(`${files.length} move-lists → ${rows.length} keyed, ${noAsset} skipped (no current asset)  ${DRY ? '(DRY RUN — no writes)' : '(WRITING)'}`);
  if (DRY || rows.length === 0) { console.log('done (dry run)'); return; }

  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('niete_lp_fidelity_moves')
      .upsert(chunk, { onConflict: 'lesson_id,version_stamp,content_hash' });
    if (error) throw error;
    written += chunk.length;
    console.log(`  upserted ${written}/${rows.length}`);
  }
  console.log(`done: ${written} rows upserted, ${noAsset} skipped`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
