#!/usr/bin/env node
'use strict';
/**
 * FEAT-059 / bd-9s1ie + bd-9dmq2 — take out/v8 to servable.
 *
 * Reads the render MANIFEST, compresses each PDF, uploads it to R2 under a
 * content-addressed key, and records it in niete_lp_assets. Re-runnable at any
 * point: identical bytes are a no-op, so the "final" run after render-ops
 * finishes is just this same command again. That is what makes the corpus
 * upload-ready the moment rendering completes.
 *
 *   node scripts/upload-lp-v8-to-r2.js \
 *     --manifest "<…>/out/v8/MANIFEST.jsonl" --root "<…>/niete-nbpro" \
 *     [--only grade_1_english] [--limit 20] [--kind lesson|answer_key] [--commit]
 *
 * DRY RUN IS THE DEFAULT. Nothing is written to R2 or the DB without --commit.
 *
 * Compression: ghostscript -dPDFSETTINGS=/ebook. Measured on this corpus,
 * 14.09 MB → 1.72 MB (12.2%) in ~0.5 s, with page text left vector-crisp
 * (only the illustrations are downsampled). Three guards, because a broken PDF
 * is worse than a big one: gs missing or failing → ship the original; output
 * not smaller → keep the original; page count changed → keep the original.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const KEY_PREFIX = 'lp-cache/v8/';
const CATALOG_VERSION = 'v8';
const GS_SETTING = '/ebook';

// ── keys + hashing ──────────────────────────────────────────────────────────

/** sha1 over the DELIVERED bytes, first 12 hex chars. */
function contentHash(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 12);
}

function r2KeyFor(lessonId, hash, assetKind = 'lesson') {
  const suffix = assetKind === 'answer_key' ? '.answer_key.pdf' : '.pdf';
  return `${KEY_PREFIX}${lessonId}/${hash}${suffix}`;
}

/**
 * Refuse to write anywhere but the new prefix.
 * The existing prod LP cache (lesson_plans/…, whatever pre_generated_lps points
 * at) must be unreachable from this pipeline — a stray key here would overwrite
 * lesson plans teachers are being served today.
 */
function assertNewPrefix(key) {
  const k = String(key || '');
  if (!k.startsWith(KEY_PREFIX) || k.includes('..')) {
    throw new Error(`refusing to write outside ${KEY_PREFIX}: ${k}`);
  }
  return true;
}

// ── manifest ────────────────────────────────────────────────────────────────

/**
 * Parse MANIFEST.jsonl text into work items, dropping anything the catalog does
 * not know about (reported on `parseManifest.lastUnknown`, never invented).
 */
function parseManifest(text, knownLessonIds, opts = {}) {
  const unknown = [];
  const items = [];
  const wantKind = opts.kind || null;

  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row;
    try { row = JSON.parse(trimmed); } catch (_) { continue; }   // a bad line must not kill the run
    if (!row || !row.id) continue;

    if (!row.files || !row.files.pdf) continue;
    if (row.blocked_by) continue;                                 // gated LPs never reach a teacher

    if (knownLessonIds && !knownLessonIds.has(row.id)) { unknown.push(row.id); continue; }

    const item = {
      lesson_id: row.id,
      asset_kind: 'lesson',
      pdf_path: row.files.pdf,
      version_stamp: row.version_stamp || null,
      source_sha1: row.pdf_sha1 || null,
      source_bytes: row.pdf_bytes || null,
      prompt_layer_sha: row.prompt_layer_sha_at_render || null,
      rendered_at: row.rendered_at || null,
    };
    if (!wantKind || wantKind === 'lesson') items.push(item);

    if (row.files.answer_key_pdf && (!wantKind || wantKind === 'answer_key')) {
      items.push({
        ...item,
        asset_kind: 'answer_key',
        pdf_path: row.files.answer_key_pdf,
        source_sha1: row.answer_key_sha1 || null,
        source_bytes: null,
      });
    }
  }

  parseManifest.lastUnknown = unknown;
  return items;
}
parseManifest.lastUnknown = [];

/**
 * A PDF on disk is NOT the same as a servable PDF. Split the gap between what
 * is on disk and what the manifest offers into the three things it can mean —
 * they need completely different responses, so they are never collapsed into
 * one "skipped" number.
 *
 * Measured against the real corpus 2026-08-16 (338 lesson PDFs, 272 manifest
 * rows with files.pdf):
 *   blocked      65 — a PDF exists from an earlier render but the row carries
 *                     blocked_by (author-cache-miss / not-rendered /
 *                     prompt-over-cap / qa-blocking). It must NOT reach a
 *                     teacher, with or without --reconcile-disk.
 *   unmanifested  1 — grade_2_urdu_ch4_seg4 has no manifest row at all. Report
 *                     it for render-ops; we cannot invent its provenance.
 *   lagging       0 — row exists, not blocked, PDF on disk, but files.pdf still
 *                     null. Possible while a render is in flight, so it stays a
 *                     distinct category; --reconcile-disk picks these up using
 *                     the row for provenance and the conventional path.
 */
function surveyDisk(manifestText, knownLessonIds, onDiskIds) {
  const lagging = [];
  const blocked = [];
  const seen = new Set();

  for (const line of String(manifestText || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row;
    try { row = JSON.parse(trimmed); } catch (_) { continue; }
    if (!row || !row.id) continue;
    seen.add(row.id);

    if (row.files && row.files.pdf) continue;              // already a work item
    if (!onDiskIds.has(row.id)) continue;                  // genuinely not rendered yet
    if (knownLessonIds && !knownLessonIds.has(row.id)) continue;

    if (row.blocked_by) { blocked.push({ lesson_id: row.id, reason: String(row.blocked_by) }); continue; }

    lagging.push({
      lesson_id: row.id,
      asset_kind: 'lesson',
      pdf_path: `out/v8/${row.id}.pdf`,
      version_stamp: row.version_stamp || null,
      source_sha1: row.pdf_sha1 || null,
      source_bytes: row.pdf_bytes || null,
      prompt_layer_sha: row.prompt_layer_sha_at_render || null,
      rendered_at: row.rendered_at || null,
      reconciled: true,
    });
  }

  const unmanifested = [...onDiskIds]
    .filter((id) => !seen.has(id) && (!knownLessonIds || knownLessonIds.has(id)))
    .sort();

  return { lagging, blocked, unmanifested };
}

// ── compression ─────────────────────────────────────────────────────────────

function pdfPageCount(buffer, tmpDir, gsBin = 'gs') {
  const p = path.join(tmpDir, `count_${crypto.randomBytes(6).toString('hex')}.pdf`);
  fs.writeFileSync(p, buffer);
  try {
    const out = execFileSync(gsBin, [
      '-q', '-dNODISPLAY', '-dNOSAFER', '-dBATCH',
      '-c', `(${p.replace(/\\/g, '/')}) (r) file runpdfbegin pdfpagecount = quit`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const n = parseInt(String(out).trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  } finally {
    try { fs.unlinkSync(p); } catch (_) { /* best effort */ }
  }
}

function gsCompress(buffer, tmpDir, gsBin = 'gs') {
  const id = crypto.randomBytes(6).toString('hex');
  const inPath = path.join(tmpDir, `in_${id}.pdf`);
  const outPath = path.join(tmpDir, `out_${id}.pdf`);
  fs.writeFileSync(inPath, buffer);
  try {
    execFileSync(gsBin, [
      '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=${GS_SETTING}`,
      '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${outPath}`, inPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return fs.readFileSync(outPath);
  } finally {
    for (const p of [inPath, outPath]) { try { fs.unlinkSync(p); } catch (_) { /* best effort */ } }
  }
}

/**
 * Compress, or explain why we are shipping the original.
 * @returns {{buffer: Buffer, compressed: boolean, reason?: string, pages: number|null}}
 */
function compressPdf(source, opts = {}) {
  const tmpDir = opts.tmpDir || os.tmpdir();
  const gsBin = opts.gsBin || 'gs';
  const doCompress = opts._compressImpl || ((b) => gsCompress(b, tmpDir, gsBin));
  const countPages = opts._pageCountImpl || ((b) => pdfPageCount(b, tmpDir, gsBin));

  const before = countPages(source);

  let out;
  try {
    out = doCompress(source);
  } catch (err) {
    return { buffer: source, compressed: false, reason: `gs failed: ${err.message.split('\n')[0]}`, pages: before };
  }
  if (!out || !out.length) {
    return { buffer: source, compressed: false, reason: 'gs produced nothing', pages: before };
  }
  if (out.length >= source.length) {
    return { buffer: source, compressed: false, reason: 'compressed output is larger — not smaller', pages: before };
  }

  const after = countPages(out);
  if (before != null && after != null && before !== after) {
    return { buffer: source, compressed: false, reason: `page count changed ${before} → ${after}`, pages: before };
  }

  return { buffer: out, compressed: true, pages: after != null ? after : before };
}

// ── planning ────────────────────────────────────────────────────────────────

/**
 * Decide what this (item, hash) needs, given the asset rows already on record.
 * Pure — the whole idempotency story is testable without R2 or a DB.
 */
function planFor(item, hash, existingRows) {
  const kind = item.asset_kind || 'lesson';
  const mine = (existingRows || []).filter(
    (r) => r.lesson_id === item.lesson_id && (r.asset_kind || 'lesson') === kind,
  );
  const current = mine.find((r) => r.is_current);
  const sameHash = mine.find((r) => r.content_hash === hash);
  const key = r2KeyFor(item.lesson_id, hash, kind);

  if (current && current.content_hash === hash) {
    return { action: 'skip', upload: false, supersede: [], r2_key: key };
  }
  if (sameHash) {
    // These bytes were served before and the object is still in R2 — flip flags.
    return {
      action: 'reinstate',
      upload: false,
      reinstate: sameHash.id,
      supersede: current ? [current.id] : [],
      r2_key: key,
    };
  }
  if (!mine.length) {
    return { action: 'first', upload: true, supersede: [], r2_key: key };
  }
  return {
    action: 'new_version',
    upload: true,
    supersede: current ? [current.id] : [],
    r2_key: key,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { commit: false, reconcileDisk: false, only: null, limit: null, kind: null, manifest: null, root: null };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    if (a === '--commit') { args.commit = true; continue; }
    if (a === '--dry-run') { args.commit = false; continue; }
    if (a === '--reconcile-disk') { args.reconcileDisk = true; continue; }
    if (a === '--only') { args.only = argv[i + 1]; i += 1; continue; }
    if (a === '--limit') { args.limit = parseInt(argv[i + 1], 10); i += 1; continue; }
    if (a === '--kind') { args.kind = argv[i + 1]; i += 1; continue; }
    if (a === '--manifest') { args.manifest = argv[i + 1]; i += 1; continue; }
    if (a === '--root') { args.root = argv[i + 1]; i += 1; continue; }
  }
  return args;
}

function catalogLessonIds() {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'lp_catalog.json'), 'utf8'));
  const ids = new Set();
  const meta = new Map();
  for (const book of catalog.books) {
    for (const ch of book.chapters) {
      for (const l of ch.lessons) {
        ids.add(l.lesson_id);
        meta.set(l.lesson_id, { grade: book.grade, subject: book.subject_key, chapter_number: ch.number, segment_index: l.segment_index });
      }
    }
  }
  return { ids, meta };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !args.root) {
    console.error('Usage: upload-lp-v8-to-r2.js --manifest <MANIFEST.jsonl> --root <niete-nbpro dir> [--only s] [--limit n] [--kind k] [--commit]');
    process.exit(2);
  }

  const { ids, meta } = catalogLessonIds();
  const manifestText = fs.readFileSync(args.manifest, 'utf8');
  let items = parseManifest(manifestText, ids, { kind: args.kind });
  const unknown = parseManifest.lastUnknown;

  // The render is live while this runs, so the manifest lags the disk. Always
  // measure the gap; only close it when asked. Never cap silently.
  const pdfDir = path.join(args.root, 'out', 'v8');
  const onDiskIds = new Set(
    fs.existsSync(pdfDir)
      ? fs.readdirSync(pdfDir)
        .filter((f) => f.endsWith('.pdf') && !f.includes('ANSWER_KEY'))
        .map((f) => f.replace(/\.pdf$/, ''))
      : [],
  );
  const survey = surveyDisk(manifestText, ids, onDiskIds);
  console.log(`disk survey: ${onDiskIds.size} lesson PDFs on disk, ${items.length} offered by the manifest`);
  if (survey.blocked.length) {
    const reasons = {};
    for (const b of survey.blocked) reasons[b.reason] = (reasons[b.reason] || 0) + 1;
    console.log(`  ⛔ ${survey.blocked.length} on disk but GATE-BLOCKED — never uploaded: ${JSON.stringify(reasons)}`);
  }
  if (survey.unmanifested.length) {
    console.log(`  ⚠ ${survey.unmanifested.length} on disk with NO manifest row — reported, not uploaded (no provenance to record):`);
    console.log(`     ${survey.unmanifested.slice(0, 10).join(', ')}`);
  }
  if (survey.lagging.length) {
    console.log(`  ⏳ ${survey.lagging.length} on disk but the manifest row still says none (render in flight).`);
    console.log(`     ${args.reconcileDisk ? 'INCLUDING them (--reconcile-disk).' : 'EXCLUDED — pass --reconcile-disk, or re-run once the manifest catches up.'}`);
    if (args.reconcileDisk && (!args.kind || args.kind === 'lesson')) items = items.concat(survey.lagging);
  }

  if (args.only) items = items.filter((i) => i.lesson_id.includes(args.only));
  if (args.limit) items = items.slice(0, args.limit);

  console.log(`=== LP v8 upload — ${args.commit ? 'COMMIT' : 'DRY RUN'} ===`);
  console.log(`manifest items: ${items.length}${unknown.length ? `  (${unknown.length} unknown ids skipped)` : ''}`);
  if (unknown.length) console.log(`  unknown: ${[...new Set(unknown)].slice(0, 10).join(', ')}`);

  let supabase = null;
  let r2 = null;
  if (args.commit) {
    supabase = require('../shared/config/supabase');
    r2 = require('../shared/storage/r2');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpv8-upload-'));
  const summary = { skipped: 0, first: 0, new_version: 0, reinstate: 0, missing: 0, failed: 0, srcBytes: 0, outBytes: 0, uncompressed: 0 };

  try {
    for (const item of items) {
      const abs = path.isAbsolute(item.pdf_path) ? item.pdf_path : path.join(args.root, item.pdf_path);
      if (!fs.existsSync(abs)) { summary.missing += 1; continue; }

      const source = fs.readFileSync(abs);
      const comp = compressPdf(source, { tmpDir });
      if (!comp.compressed) { summary.uncompressed += 1; console.log(`  ~ ${item.lesson_id}: uncompressed (${comp.reason})`); }

      const hash = contentHash(comp.buffer);
      const key = r2KeyFor(item.lesson_id, hash, item.asset_kind);
      assertNewPrefix(key);

      let existing = [];
      if (args.commit) {
        const { data } = await supabase
          .from('niete_lp_assets')
          .select('id, lesson_id, asset_kind, content_hash, is_current')
          .eq('lesson_id', item.lesson_id);
        existing = data || [];
      }

      const plan = planFor(item, hash, existing);
      summary.srcBytes += source.length;
      summary.outBytes += comp.buffer.length;
      summary[plan.action] = (summary[plan.action] || 0) + 1;

      if (!args.commit) {
        console.log(`  ${plan.action.padEnd(12)} ${item.lesson_id} ${(source.length / 1048576).toFixed(1)}MB→${(comp.buffer.length / 1048576).toFixed(2)}MB  ${plan.r2_key}`);
        continue;
      }
      if (plan.action === 'skip') continue;

      try {
        if (plan.upload) await r2.uploadBuffer(comp.buffer, key, 'application/pdf');

        for (const id of plan.supersede) {
          await supabase.from('niete_lp_assets')
            .update({ is_current: false, superseded_at: new Date().toISOString() })
            .eq('id', id);
        }
        if (plan.action === 'reinstate') {
          await supabase.from('niete_lp_assets')
            .update({ is_current: true, superseded_at: null })
            .eq('id', plan.reinstate);
        } else {
          const m = meta.get(item.lesson_id) || {};
          await supabase.from('niete_lp_assets').insert({
            lesson_id: item.lesson_id,
            catalog_version: CATALOG_VERSION,
            version_stamp: item.version_stamp || CATALOG_VERSION,
            content_hash: hash,
            r2_key: key,
            bytes: comp.buffer.length,
            source_bytes: source.length,
            source_sha1: item.source_sha1,
            prompt_layer_sha: item.prompt_layer_sha,
            rendered_at: item.rendered_at,
            asset_kind: item.asset_kind,
            is_current: true,
          });
          void m;
        }
        console.log(`  ✓ ${plan.action.padEnd(12)} ${item.lesson_id} → ${key}`);
      } catch (err) {
        summary.failed += 1;
        console.log(`  ✗ ${item.lesson_id}: ${err.message}`);
      }
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }

  console.log('\n--- summary ---');
  console.log(`  first=${summary.first} new_version=${summary.new_version} reinstate=${summary.reinstate} skip=${summary.skipped || summary.skip || 0}`);
  console.log(`  missing-on-disk=${summary.missing} failed=${summary.failed} shipped-uncompressed=${summary.uncompressed}`);
  if (summary.srcBytes) {
    console.log(`  ${(summary.srcBytes / 1048576).toFixed(0)} MB → ${(summary.outBytes / 1048576).toFixed(0)} MB (${(100 * summary.outBytes / summary.srcBytes).toFixed(1)}%)`);
  }
  if (!args.commit) console.log('\n  DRY RUN — nothing written. Re-run with --commit.');
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
}

module.exports = {
  contentHash,
  r2KeyFor,
  assertNewPrefix,
  parseManifest,
  surveyDisk,
  compressPdf,
  pdfPageCount,
  planFor,
  parseArgs,
  KEY_PREFIX,
  GS_SETTING,
};
