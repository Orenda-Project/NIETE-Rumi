#!/usr/bin/env node
'use strict';
/**
 * Recover the slide script for lessons that were uploaded before anything wanted it.
 *
 *   node scripts/backfill-lp-asset-sources.js --input <backfill_input.json> [--dry-run] [--limit N]
 *
 * DRY RUN IS NOT THE DEFAULT here (unlike the uploader) — but nothing is written
 * without a proof, and the proof is the point of this script.
 *
 * The input is exported from the ICT K-5 curriculum matrix, one row per lesson:
 *
 *   [{ "lesson_id": "grade_2_math_ch3_seg4",
 *      "lp_url": "https://…/lp-cache/v8/grade_2_math_ch3_seg4/<hash>.pdf",
 *      "slide_script_url": "https://…/…/_slide_script.json" }, …]
 *
 * A spreadsheet is edited by people, so a row is only imported when it proves it is
 * about the object we actually serve:
 *
 *      basename(lp_url)  ===  "<the current asset's own content_hash>.pdf"
 *
 * The content hash is sha1 over the delivered bytes, so that equality IS the identity
 * of the served PDF — not a name that happens to look similar. It held for
 * 1,211 / 1,211 lessons taken in the week to 22 Sep 2026, so a mismatch is not noise
 * to tolerate: it is a row about a different version, and importing it would let a
 * teacher be quizzed on a lesson plan they do not hold.
 *
 * Everything that can go wrong gets a named reason, printed per lesson and totalled:
 *   no_input_row      the served asset has no matrix row (or the row has no script link)
 *   link_mismatch     the matrix LP link is not the object we serve
 *   fetch_failed      the script URL did not return 200 (plain GET; the bucket
 *                     refuses HEAD and ranged GETs, so never probe with one)
 *   bad_json          the body is not JSON, or not a slide script (no iDo / no meta)
 *   no_current_asset  the matrix names a lesson we serve nothing for
 *
 * It never guesses a URL and never falls back to "the newest script for this lesson".
 */

const fs = require('fs');
const path = require('path');

const SKIP_REASONS = ['no_input_row', 'link_mismatch', 'fetch_failed', 'bad_json', 'no_current_asset'];
const ASSET_TABLE = 'niete_lp_assets';
const PAGE = 500;

function parseArgs(argv) {
  const args = { inputPath: null, dryRun: false, limit: null };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (a === '--input') { args.inputPath = argv[i + 1]; i += 1; continue; }
    if (a === '--limit') { args.limit = parseInt(argv[i + 1], 10); i += 1; continue; }
  }
  return args;
}

/** The file name an R2 key or a matrix link ends in, with any query or fragment removed. */
function objectName(url) {
  const raw = String(url || '').split('#')[0].split('?')[0];
  let name = raw.split('/').filter(Boolean).pop() || '';
  try { name = decodeURIComponent(name); } catch (_) { /* a stray % stays as typed */ }
  return name;
}

/** The folder an R2 key or a matrix link sits in (the lesson id, for lp-cache/v8/<lesson_id>/<hash>.pdf). */
function parentName(url) {
  const parts = String(url || '').split('#')[0].split('?')[0].split('/').filter(Boolean);
  let name = parts.length > 1 ? parts[parts.length - 2] : '';
  try { name = decodeURIComponent(name); } catch (_) { /* a stray % stays as typed */ }
  return name;
}

/**
 * Is this matrix row about the object the bot serves for that lesson?
 * All three must agree: the link names <content_hash>.pdf, the asset's own r2_key
 * names the same object, and the link sits in that lesson's folder. The hash is the
 * identity of the bytes; the key and the folder only stop a corrupt row or a
 * copy-pasted link from another lesson borrowing it.
 */
function linkMatchesAsset(lpUrl, asset) {
  if (!asset || !asset.content_hash) return false;
  const expected = `${asset.content_hash}.pdf`;
  return objectName(lpUrl) === expected
    && objectName(asset.r2_key) === expected
    && parentName(lpUrl) === String(asset.lesson_id || '');
}

/** A slide script, or not. The shape check is deliberately shallow — this is a gate, not a validator. */
function isSlideScript(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && v.meta && v.iDo;
}

function readInput(inputPath) {
  const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const rows = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.rows) ? parsed.rows : null);
  if (!rows) throw new Error(`--input must hold an array of {lesson_id, lp_url, slide_script_url}: ${inputPath}`);
  const byLesson = new Map();
  for (const r of rows) {
    if (r && r.lesson_id) byLesson.set(String(r.lesson_id), r);
  }
  return byLesson;
}

/**
 * Every CURRENT lesson asset, paged. PostgREST caps a response at 1,000 rows and the
 * corpus is larger than that, so an unpaged read would silently backfill a prefix.
 */
async function currentLessonAssets(client) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from(ASSET_TABLE)
      .select('id, lesson_id, version_stamp, content_hash, r2_key')
      .eq('is_current', true)
      .eq('asset_kind', 'lesson')
      .order('lesson_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${ASSET_TABLE}: ${error.message || error}`);
    const page = data || [];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/**
 * @returns {Promise<{assets:number, written:number, wouldWrite:number, dryRun:boolean,
 *                    skipped:Object<string,number>, details:Array}>}
 */
async function run({ inputPath, dryRun = false, limit = null, deps = {} }) {
  const client = deps.client || require('../shared/config/supabase');
  const doFetch = deps.fetch || globalThis.fetch;
  const store = deps.sourceStore || require('../shared/services/quiz/lp-asset-source.store');
  const log = deps.log || console.log;

  const byLesson = readInput(inputPath);
  let assets = await currentLessonAssets(client);
  const assetLessons = new Set(assets.map((a) => a.lesson_id));
  if (limit) assets = assets.slice(0, limit);

  const skipped = {};
  const details = [];
  const skip = (lessonId, reason, note) => {
    skipped[reason] = (skipped[reason] || 0) + 1;
    details.push({ lesson_id: lessonId, reason, note: note || null });
    log(`  · ${String(lessonId).padEnd(34)} ${reason}${note ? ` — ${note}` : ''}`);
  };

  let written = 0;
  let wouldWrite = 0;

  for (const a of assets) {
    const row = byLesson.get(a.lesson_id);
    if (!row) { skip(a.lesson_id, 'no_input_row'); continue; }
    if (!row.slide_script_url) { skip(a.lesson_id, 'no_input_row', 'the matrix row carries no slide-script link'); continue; }
    if (!linkMatchesAsset(row.lp_url, a)) {
      skip(a.lesson_id, 'link_mismatch', `matrix ${objectName(row.lp_url) || '(none)'} ≠ served ${objectName(a.r2_key)}`);
      continue;
    }

    let body;
    try {
      // Plain GET. The bucket refuses HEAD and ranged GETs, so a "cheap" probe
      // reads as a dead link and would skip a lesson that is perfectly fine.
      const res = await doFetch(row.slide_script_url);
      if (!res || !res.ok) { skip(a.lesson_id, 'fetch_failed', `HTTP ${res ? res.status : 'no response'}`); continue; }
      body = await res.text();
    } catch (err) {
      skip(a.lesson_id, 'fetch_failed', (err.message || String(err)).split('\n')[0]);
      continue;
    }

    let script;
    try {
      script = JSON.parse(body);
    } catch (err) {
      skip(a.lesson_id, 'bad_json', (err.message || String(err)).split('\n')[0]);
      continue;
    }
    if (!isSlideScript(script)) { skip(a.lesson_id, 'bad_json', 'parsed, but has no meta/iDo — not a slide script'); continue; }

    if (dryRun) { wouldWrite += 1; continue; }

    await store.upsertSource({
      asset_id: a.id,
      lesson_id: a.lesson_id,
      version_stamp: a.version_stamp,
      content_hash: a.content_hash,
      slide_script: script,
      source_url: row.slide_script_url,
      verified: 'backfill:link',
    });
    written += 1;
  }

  // The other direction: a matrix row for a lesson we serve nothing for. Counted
  // whether or not --limit trimmed the work, because it is about the input, not the run.
  for (const [lessonId] of byLesson) {
    if (!assetLessons.has(lessonId)) skip(lessonId, 'no_current_asset');
  }

  return { assets: assets.length, written, wouldWrite, dryRun: Boolean(dryRun), skipped, details };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inputPath) {
    console.error('Usage: backfill-lp-asset-sources.js --input <backfill_input.json> [--dry-run] [--limit N]');
    process.exit(2);
  }
  console.log(`=== LP asset sources backfill — ${args.dryRun ? 'DRY RUN' : 'WRITING'} ===`);
  console.log(`input: ${path.resolve(args.inputPath)}${args.limit ? `  (limit ${args.limit})` : ''}`);

  const out = await run(args);

  console.log('\n--- summary ---');
  console.log(`  current lesson assets considered: ${out.assets}`);
  console.log(`  ${out.dryRun ? `would write: ${out.wouldWrite}` : `written: ${out.written}`}`);
  for (const reason of SKIP_REASONS) {
    if (out.skipped[reason]) console.log(`  ${reason.padEnd(18)} ${out.skipped[reason]}`);
  }
  if (out.dryRun) console.log('\n  DRY RUN — nothing written. Re-run without --dry-run.');
  return out;
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}

module.exports = {
  main, run, parseArgs, readInput, currentLessonAssets,
  linkMatchesAsset, objectName, parentName, isSlideScript, SKIP_REASONS, ASSET_TABLE, PAGE,
};
