#!/usr/bin/env node
'use strict';
/**
 * Prove an uploaded lesson plan is actually fetchable — the way a teacher's
 * phone fetches it.
 *
 * "It uploaded" and "the DB has a row" are two hypotheses, not a delivery. This
 * pulls the bytes back down through the SAME path the delivery uses
 * (getPresignedUrl(buildR2PublicUrl(key)) → plain HTTPS GET, no credentials on
 * the request) and checks them against what niete_lp_assets claims:
 *
 *   HTTP 200 · %PDF magic · byte length == bytes · sha1(bytes)[0:12] == content_hash
 *
 * The presign step is the point. buildR2PublicUrl alone returns the S3-endpoint
 * URL, which anonymous GETs reject with HTTP 400 — a failure this deployment
 * has already paid for once, and exactly what this script catches before a
 * teacher does.
 *
 *   node scripts/verify-lp-v8-r2.js                 # 5 random current assets
 *   node scripts/verify-lp-v8-r2.js --sample 25
 *   node scripts/verify-lp-v8-r2.js --all
 *   node scripts/verify-lp-v8-r2.js --lesson grade_1_english_ch1_seg1
 *
 * Read-only against R2 and the DB.
 */

const crypto = require('crypto');

const PAGE = 1000;   // PostgREST db-max-rows on this project — see lp-v8-delivery.service.js

// ── pure helpers (unit-tested; no network) ──────────────────────────────────

function parseArgs(argv) {
  const args = { sample: 5, all: false, lesson: null, kind: null, fromReport: null };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    if (a === '--all') { args.all = true; continue; }
    if (a === '--sample') { args.sample = parseInt(argv[i + 1], 10); i += 1; continue; }
    if (a === '--lesson') { args.lesson = argv[i + 1]; i += 1; continue; }
    if (a === '--kind') { args.kind = argv[i + 1]; i += 1; continue; }
    // Before migration 018 there are no rows to read, so the run report is the
    // only record of what went up. Takes a report file or the directory of them.
    if (a === '--from-report') { args.fromReport = argv[i + 1]; i += 1; continue; }
  }
  return args;
}

/** The uploaded objects named by a run report — failures and misses excluded. */
function rowsFromReport(report) {
  return ((report && report.items) || [])
    .filter((it) => it.r2_key && it.content_hash && it.action !== 'failed' && it.action !== 'missing')
    .map((it) => ({
      lesson_id: it.lesson_id,
      asset_kind: it.asset_kind || 'lesson',
      r2_key: it.r2_key,
      content_hash: it.content_hash,
      bytes: it.bytes,
    }));
}

/** Newest run report under a directory (or the file itself if given one). */
function resolveReportPath(target) {
  const fs = require('fs');
  const path = require('path');
  if (!target) return null;
  const stat = fs.statSync(target);
  if (stat.isFile()) return target;
  const files = fs.readdirSync(target)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(target, f))
    .sort();
  return files.length ? files[files.length - 1] : null;
}

/**
 * Deterministic spread across the corpus rather than the first N rows — the
 * first N are all one book, and one book passing says nothing about the rest.
 */
function pickSample(rows, n) {
  const sorted = [...rows].sort((a, b) => String(a.lesson_id).localeCompare(String(b.lesson_id)));
  if (!sorted.length || n >= sorted.length) return sorted;
  const step = sorted.length / n;
  return Array.from({ length: n }, (_, i) => sorted[Math.floor(i * step)]);
}

/** Everything that can be wrong with the bytes that came back. */
function checkFetched(buffer, row, httpStatus) {
  const problems = [];
  if (httpStatus !== 200) problems.push(`HTTP ${httpStatus}`);
  if (!buffer || !buffer.length) {
    problems.push('empty body');
    return { ok: false, problems };
  }
  if (buffer.slice(0, 4).toString('latin1') !== '%PDF') problems.push('not a PDF (no %PDF magic)');
  if (row.bytes != null && buffer.length !== Number(row.bytes)) {
    problems.push(`length ${buffer.length} != recorded ${row.bytes}`);
  }
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 12);
  if (row.content_hash && hash !== row.content_hash) {
    problems.push(`content_hash ${hash} != recorded ${row.content_hash}`);
  }
  return { ok: problems.length === 0, problems, hash, bytes: buffer.length };
}

// ── the run ─────────────────────────────────────────────────────────────────

async function fetchAllCurrent(supabase, { lesson, kind }) {
  const rows = [];
  for (let page = 0; page < 20; page += 1) {
    let q = supabase
      .from('niete_lp_assets')
      .select('lesson_id, asset_kind, r2_key, content_hash, bytes, version_stamp')
      .eq('is_current', true);
    if (lesson) q = q.eq('lesson_id', lesson);
    if (kind) q = q.eq('asset_kind', kind);
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await q.range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`niete_lp_assets read failed: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < PAGE) break;
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { buildR2PublicUrl, getPresignedUrl } = require('../shared/storage/r2');

  let all;
  if (args.fromReport) {
    const fs = require('fs');
    const reportPath = resolveReportPath(args.fromReport);
    if (!reportPath) { console.log(`No run report under ${args.fromReport}`); process.exit(1); }
    console.log(`reading uploads from ${reportPath}`);
    all = rowsFromReport(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
  } else {
    const supabase = require('../shared/config/supabase');
    all = await fetchAllCurrent(supabase, args);
  }

  if (!all.length) {
    console.log('Nothing to verify — no current niete_lp_assets rows and no uploads in the report.');
    process.exit(1);
  }
  const rows = args.all || args.lesson ? all : pickSample(all, args.sample);
  console.log(`=== verify lp-v8 in R2 — ${rows.length} of ${all.length} current assets ===\n`);

  let bad = 0;
  for (const row of rows) {
    const signed = await getPresignedUrl(buildR2PublicUrl(row.r2_key));   // eslint-disable-line no-await-in-loop
    let status = 0;
    let buf = Buffer.alloc(0);
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(signed);
      status = res.status;
      // eslint-disable-next-line no-await-in-loop
      buf = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.log(`  ✗ ${row.lesson_id} — fetch threw: ${err.message}`);
      bad += 1;
      continue;
    }
    const verdict = checkFetched(buf, row, status);
    if (verdict.ok) {
      console.log(`  ✓ ${row.lesson_id.padEnd(34)} ${(buf.length / 1048576).toFixed(2)} MB  ${row.r2_key}`);
    } else {
      bad += 1;
      console.log(`  ✗ ${row.lesson_id.padEnd(34)} ${verdict.problems.join('; ')}`);
    }
  }

  console.log(`\n--- ${rows.length - bad} verified, ${bad} failed ---`);
  if (bad) process.exit(1);
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
}

module.exports = { parseArgs, pickSample, checkFetched, rowsFromReport, resolveReportPath };
