#!/usr/bin/env node
'use strict';
/**
 * Backfill niete_lp_fidelity_moves from the offline-extracted move-lists (bd-wmfsp.3, P1.2; GB: bd-ra8xu.55).
 *
 * Batched: read the CURRENT 'lesson' assets once (paged) → map lesson_id → version keys, then bulk-upsert
 * the move-lists in chunks. Keyed by (lesson_id, version_stamp, content_hash) identical to niete_lp_assets,
 * so a coaching session resolves the moves for the exact LP version the teacher downloaded.
 *
 * ⚠️ PROD WRITE — needs an explicit operator "go" (root CLAUDE.md Rule 7), runs against the NIETE DB.
 * Safety:
 *   - bd-2536: refuses any database but the one expected — NIETE prod by default; staging/sandbox only when named
 *     with --expect-ref <project ref>.
 *   - --dry-run reads only, and says how many rows it would insert vs update.
 *   - bd-ra8xu.55: a write needs --backup <file>: every row of every lesson it touches (all versions) is saved there
 *     first, and --undo <file> deletes those lessons' rows and puts the saved ones back exactly.
 *   - a move-list that names the PDF it was made from (content_hash) is skipped when that is not the served version.
 *
 * Usage:
 *   MOVES_DIR=/path/to/moves node scripts/backfill-lp-fidelity-moves.js --dry-run [--prefix gb_] [--expect-ref <ref>]
 *   MOVES_DIR=... node scripts/backfill-lp-fidelity-moves.js --backup <file.json> [--prefix gb_] [--expect-ref <ref>]
 *   node scripts/backfill-lp-fidelity-moves.js --undo <file.json> [--dry-run] [--expect-ref <ref>]
 */
const fs = require('fs');
const path = require('path');

const EXPECTED_REF = 'ihzciabopbttygxxgrkm'; // NIETE prod Supabase project ref
const TABLE = 'niete_lp_fidelity_moves';
const CHUNK = 400;
const IN_CHUNK = 200;

function refOf(url) {
  return (String(url || '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || null;
}

function assertRef(url, expected = EXPECTED_REF) {
  const ref = refOf(url);
  if (ref !== expected) {
    throw new Error(`REFUSING TO RUN: SUPABASE_URL ref='${ref}' is not the expected '${expected}'. ` +
      `A worktree seeded with the main-bot .env points at the WRONG prod DB (bd-2536). Fix .env, or name the ` +
      `database you mean with --expect-ref.`);
  }
  return ref;
}

function parseArgs(argv) {
  const val = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  return {
    dry: argv.includes('--dry-run'),
    expectRef: val('--expect-ref') || EXPECTED_REF,
    prefix: val('--prefix') || '',
    backup: val('--backup') || null,
    undo: val('--undo') || null,
  };
}

const keyOf = (r) => `${r.lesson_id}|${r.version_stamp}|${r.content_hash}`;
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

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

/** Move-list files → rows keyed to the current asset. Pure. */
function buildRows(files, assets, { prefix = '' } = {}) {
  const rows = [];
  const skipped = { no_asset: 0, stale_version: 0, other_prefix: 0 };
  for (const ext of files) {
    if (prefix && !String(ext.lesson_id || '').startsWith(prefix)) { skipped.other_prefix++; continue; }
    const a = assets.get(ext.lesson_id);
    if (!a) { skipped.no_asset++; continue; }
    if (ext.content_hash && ext.content_hash !== a.content_hash) { skipped.stale_version++; continue; }
    rows.push({
      lesson_id: ext.lesson_id,
      catalog_version: a.catalog_version, version_stamp: a.version_stamp, content_hash: a.content_hash,
      brief_sha: ext.brief_sha, template: ext.template, total_minutes: ext.total_minutes,
      moves: ext.moves, n_moves: (ext.moves || []).length, model: ext.model,
      updated_at: new Date().toISOString(),
    });
  }
  return { rows, skipped };
}

function readMovesDir(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.moves.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

/** Every row, any version, of these lessons. */
async function rowsOfLessons(supabase, lessonIds) {
  const out = [];
  for (const ids of chunks(lessonIds, IN_CHUNK)) {
    const { data, error } = await supabase.from(TABLE).select('*').in('lesson_id', ids);
    if (error) throw error;
    out.push(...data);
  }
  return out;
}

async function runUndo(supabase, opts, env, log) {
  const saved = JSON.parse(fs.readFileSync(opts.undo, 'utf8'));
  const ref = refOf(env.SUPABASE_URL);
  if (saved.ref !== ref) throw new Error(`REFUSING TO UNDO: the backup was taken on '${saved.ref}', this is '${ref}'.`);
  const lessonIds = saved.lesson_ids || [];
  const restore = saved.rows || [];
  log(`undo: ${lessonIds.length} lessons → delete their rows, put back ${restore.length} saved rows ${opts.dry ? '(DRY RUN — no writes)' : '(WRITING)'}`);
  if (opts.dry) return { mode: 'undo-dry-run', lessons: lessonIds.length, would_restore: restore.length };
  for (const ids of chunks(lessonIds, IN_CHUNK)) {
    const { error } = await supabase.from(TABLE).delete().in('lesson_id', ids);
    if (error) throw error;
  }
  for (const part of chunks(restore, CHUNK)) {
    const { error } = await supabase.from(TABLE).insert(part);
    if (error) throw error;
  }
  log(`undo done: ${lessonIds.length} lessons cleared, ${restore.length} rows restored`);
  return { mode: 'undo', deleted_lessons: lessonIds.length, restored: restore.length };
}

/**
 * @param {string[]} argv
 * @param {{client?:object, env?:object, log?:Function}} deps  injectable for tests
 */
async function run(argv, deps = {}) {
  const env = deps.env || process.env;
  const log = deps.log || console.log;
  const opts = parseArgs(argv);
  if (!opts.undo && !opts.dry && !opts.backup) {
    throw new Error('a write needs --backup <file.json> (every row of the touched lessons is saved there first); or use --dry-run');
  }
  if (!opts.undo && !env.MOVES_DIR) throw new Error('set MOVES_DIR to the dir of <lesson_id>.moves.json files');
  const ref = assertRef(env.SUPABASE_URL || env.NIETE_SUPABASE_URL, opts.expectRef);
  const supabase = deps.client || require('../bot/shared/config/supabase');

  if (opts.undo) return runUndo(supabase, opts, env, log);

  const assets = await loadAssetMap(supabase);
  log(`asset map: ${assets.size} current 'lesson' assets (db ${ref})`);
  const files = readMovesDir(env.MOVES_DIR);
  const { rows, skipped } = buildRows(files, assets, { prefix: opts.prefix });
  const lessonIds = [...new Set(rows.map((r) => r.lesson_id))];
  const existing = await rowsOfLessons(supabase, lessonIds);
  const atKey = new Set(existing.map(keyOf));
  const wouldUpdate = rows.filter((r) => atKey.has(keyOf(r))).length;
  const summary = {
    files: files.length, keyed: rows.length, skipped,
    would_insert: rows.length - wouldUpdate, would_update: wouldUpdate, existing_rows_of_these_lessons: existing.length,
  };
  log(`${files.length} move-lists → ${rows.length} keyed (${summary.would_insert} insert, ${wouldUpdate} update); ` +
    `skipped ${JSON.stringify(skipped)}  ${opts.dry ? '(DRY RUN — no writes)' : '(WRITING)'}`);
  if (opts.dry || rows.length === 0) return { mode: 'dry-run', ...summary };

  fs.writeFileSync(opts.backup, JSON.stringify({
    ref, at: new Date().toISOString(), table: TABLE, lesson_ids: lessonIds, keys: rows.map(keyOf), rows: existing,
  }));
  log(`backup: ${existing.length} rows of ${lessonIds.length} lessons → ${opts.backup}`);

  let written = 0;
  for (const part of chunks(rows, CHUNK)) {
    const { error } = await supabase.from(TABLE).upsert(part, { onConflict: 'lesson_id,version_stamp,content_hash' });
    if (error) throw error;
    written += part.length;
    log(`  upserted ${written}/${rows.length}`);
  }
  log(`done: ${written} rows upserted; undo with: node scripts/backfill-lp-fidelity-moves.js --undo ${opts.backup} --expect-ref ${ref}`);
  return { mode: 'write', ...summary, written, backup: opts.backup };
}

module.exports = { assertRef, buildRows, parseArgs, run, EXPECTED_REF };

if (require.main === module) {
  run(process.argv.slice(2)).then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}
