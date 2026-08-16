#!/usr/bin/env node
'use strict';
/**
 * Take out/v8 to servable.
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
/**
 * The PDFs live beside their own manifest. Hardcoding out/v8 meant a v8u run
 * surveyed the v8 directory and reported all 466 English PDFs as "missing from
 * the Urdu manifest".
 */
function pdfDirForManifest(manifestPath) {
  return path.dirname(path.resolve(String(manifestPath || '')));
}

function surveyDisk(manifestText, knownLessonIds, onDiskIds, opts = {}) {
  const lagging = [];
  const blocked = [];
  const seen = new Set();
  const pdfDir = opts.pdfDir || null;

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
      pdf_path: pdfDir ? path.join(pdfDir, `${row.id}.pdf`) : `out/v8/${row.id}.pdf`,
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

// pdfwrite stamps a CreationDate/ModDate and a random /ID into every output, so
// compressing the SAME pdf twice normally gives two different sha1s (measured on
// gs 10.07.0: cd0ad810… vs 309334bd…). That would make every re-run look like a
// re-render: new key, new row, old asset superseded, whole corpus re-uploaded.
// These three flags make the output byte-identical (and marginally smaller).
const GS_DETERMINISTIC_FLAGS = ['-dOmitInfoDate=true', '-dOmitID=true', '-dOmitXMP=true'];

function gsCompress(buffer, tmpDir, gsBin = 'gs', extraFlags = []) {
  const id = crypto.randomBytes(6).toString('hex');
  const inPath = path.join(tmpDir, `in_${id}.pdf`);
  const outPath = path.join(tmpDir, `out_${id}.pdf`);
  fs.writeFileSync(inPath, buffer);
  try {
    execFileSync(gsBin, [
      '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=${GS_SETTING}`,
      '-dNOPAUSE', '-dQUIET', '-dBATCH', ...extraFlags, `-sOutputFile=${outPath}`, inPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return fs.readFileSync(outPath);
  } finally {
    for (const p of [inPath, outPath]) { try { fs.unlinkSync(p); } catch (_) { /* best effort */ } }
  }
}

/**
 * Compress, or explain why we are shipping the original.
 *
 * Tries the deterministic flags first and falls back to a plain invocation if
 * this ghostscript does not know them — an older gs loses reproducibility but
 * keeps the 88% saving, and planFor's source-sha1 check keeps the run idempotent
 * either way.
 *
 * @returns {{buffer: Buffer, compressed: boolean, deterministic: boolean, reason?: string, pages: number|null}}
 */
function compressPdf(source, opts = {}) {
  const tmpDir = opts.tmpDir || os.tmpdir();
  const gsBin = opts.gsBin || 'gs';
  const doCompress = opts._compressImpl
    || ((b, flags) => gsCompress(b, tmpDir, gsBin, flags));
  const countPages = opts._pageCountImpl || ((b) => pdfPageCount(b, tmpDir, gsBin));

  const before = countPages(source);

  let out;
  let deterministic = true;
  let firstError = null;
  try {
    out = doCompress(source, GS_DETERMINISTIC_FLAGS);
  } catch (err) {
    firstError = err;
    deterministic = false;
    try {
      out = doCompress(source, []);
    } catch (err2) {
      return {
        buffer: source, compressed: false, deterministic: false, pages: before,
        reason: `gs failed: ${(err2.message || String(err2)).split('\n')[0]}`,
      };
    }
  }
  void firstError;
  if (!out || !out.length) {
    return { buffer: source, compressed: false, deterministic: false, reason: 'gs produced nothing', pages: before };
  }
  if (out.length >= source.length) {
    return {
      buffer: source, compressed: false, deterministic,
      reason: 'compressed output is larger — not smaller', pages: before,
    };
  }

  const after = countPages(out);
  if (before != null && after != null && before !== after) {
    return {
      buffer: source, compressed: false, deterministic,
      reason: `page count changed ${before} → ${after}`, pages: before,
    };
  }

  return { buffer: out, compressed: true, deterministic, pages: after != null ? after : before };
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
  // Second identity check, on the RENDER rather than the compressed bytes.
  // Compression is only byte-stable when this ghostscript understands the
  // deterministic flags; across gs versions or machines the same render can
  // compress to different bytes. The manifest's pdf_sha1 does not move, so it
  // is what stops a re-run re-uploading a corpus it already shipped.
  if (current && item.source_sha1 && current.source_sha1 === item.source_sha1) {
    return {
      action: 'skip',
      upload: false,
      supersede: [],
      r2_key: r2KeyFor(item.lesson_id, current.content_hash, kind),
      reason: 'same source render already current (source_sha1 match)',
    };
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

// ── prepared SQL (for --r2-only, before migration 018 is applied) ───────────

function sqlLiteral(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * The niete_lp_assets rows for objects already in R2, as SQL that is safe to
 * apply late and twice.
 *
 * supersede-then-insert, not plain insert: idx_lp_assets_one_current is a
 * PARTIAL unique index on (lesson_id, asset_kind) WHERE is_current, so a second
 * current row for a lesson is a constraint violation rather than a duplicate.
 * ON CONFLICT on the identity index makes a re-apply a no-op, and the whole file
 * is one transaction so a half-applied file cannot leave two current rows.
 */
function buildInsertSql(rows) {
  const list = (rows || []).filter((r) => r && r.lesson_id && r.content_hash && r.r2_key);
  if (!list.length) return '';

  const out = ['BEGIN;', ''];
  for (const r of list) {
    const kind = r.asset_kind || 'lesson';
    out.push(
      'UPDATE niete_lp_assets SET is_current = false, superseded_at = NOW()',
      `  WHERE lesson_id = ${sqlLiteral(r.lesson_id)}`,
      `    AND asset_kind = ${sqlLiteral(kind)}`,
      '    AND is_current',
      `    AND content_hash <> ${sqlLiteral(r.content_hash)};`,
      'INSERT INTO niete_lp_assets',
      '  (lesson_id, catalog_version, version_stamp, content_hash, r2_key, bytes,',
      '   source_bytes, source_sha1, prompt_layer_sha, rendered_at, asset_kind, is_current)',
      `VALUES (${sqlLiteral(r.lesson_id)}, ${sqlLiteral(CATALOG_VERSION)}, `
        + `${sqlLiteral(r.version_stamp || CATALOG_VERSION)}, ${sqlLiteral(r.content_hash)}, `
        + `${sqlLiteral(r.r2_key)}, ${sqlLiteral(r.bytes)},`,
      `        ${sqlLiteral(r.source_bytes)}, ${sqlLiteral(r.source_sha1)}, `
        + `${sqlLiteral(r.prompt_layer_sha)}, ${sqlLiteral(r.rendered_at)}, ${sqlLiteral(kind)}, true)`,
      'ON CONFLICT (lesson_id, asset_kind, content_hash) DO NOTHING;',
      '',
    );
  }
  out.push('COMMIT;');
  return `${out.join('\n')}\n`;
}

// ── run report ──────────────────────────────────────────────────────────────

/**
 * One machine-readable record per run, written next to the corpus. The point is
 * the negative space: what was NOT uploaded and why. A run that says "290
 * uploaded" and nothing else reads as "the corpus is live" when 193 lessons are
 * sitting behind a gate.
 */
function buildRunReport({ manifest, commit, items, survey, startedAt, finishedAt }) {
  const counts = {};
  const failures = [];
  let source = 0;
  let delivered = 0;

  for (const it of items || []) {
    counts[it.action] = (counts[it.action] || 0) + 1;
    if (it.action === 'failed') failures.push({ lesson_id: it.lesson_id, reason: it.reason || null });
    source += Number(it.source_bytes || 0);
    delivered += Number(it.bytes || 0);
  }

  return {
    manifest,
    mode: commit ? 'commit' : 'dry-run',
    started_at: startedAt || null,
    finished_at: finishedAt || null,
    counts,
    bytes: { source, delivered },
    failures,
    blocked: (survey && survey.blocked) || [],
    unmanifested: (survey && survey.unmanifested) || [],
    lagging: ((survey && survey.lagging) || []).map((l) => l.lesson_id),
    items: (items || []).map((it) => ({
      lesson_id: it.lesson_id,
      asset_kind: it.asset_kind || 'lesson',
      action: it.action,
      r2_key: it.r2_key || null,
      content_hash: it.content_hash || null,
      bytes: it.bytes || null,
      source_bytes: it.source_bytes || null,
      compressed: it.compressed !== undefined ? it.compressed : null,
      deterministic: it.deterministic !== undefined ? it.deterministic : null,
      reason: it.reason || null,
    })),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    commit: false, r2Only: false, reconcileDisk: false,
    only: null, limit: null, kind: null, manifest: null, root: null,
  };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    if (a === '--commit') { args.commit = true; continue; }
    // Upload the bytes, prepare the rows as SQL. For the window where 018 has
    // not been applied yet — the objects are inert until a row points at them.
    if (a === '--r2-only') { args.r2Only = true; continue; }
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
  // The PDFs sit beside their own manifest — v8 and v8u are separate trees.
  const pdfDir = pdfDirForManifest(args.manifest);
  const onDiskIds = new Set(
    fs.existsSync(pdfDir)
      ? fs.readdirSync(pdfDir)
        .filter((f) => f.endsWith('.pdf') && !f.includes('ANSWER_KEY'))
        .map((f) => f.replace(/\.pdf$/, ''))
      : [],
  );
  const survey = surveyDisk(manifestText, ids, onDiskIds, { pdfDir });
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

  const mode = args.commit ? 'COMMIT' : (args.r2Only ? 'R2-ONLY (rows prepared as SQL, not written)' : 'DRY RUN');
  console.log(`=== LP v8 upload — ${mode} ===`);
  console.log(`manifest items: ${items.length}${unknown.length ? `  (${unknown.length} unknown ids skipped)` : ''}`);
  if (unknown.length) console.log(`  unknown: ${[...new Set(unknown)].slice(0, 10).join(', ')}`);

  let supabase = null;
  let r2 = null;
  if (args.commit) {
    supabase = require('../shared/config/supabase');
    r2 = require('../shared/storage/r2');
  } else if (args.r2Only) {
    r2 = require('../shared/storage/r2');   // no DB client — nothing here writes a row
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpv8-upload-'));
  const summary = { skipped: 0, first: 0, new_version: 0, reinstate: 0, missing: 0, failed: 0, srcBytes: 0, outBytes: 0, uncompressed: 0 };
  const outcomes = [];
  const startedAt = new Date().toISOString();

  try {
    for (const item of items) {
      const abs = path.isAbsolute(item.pdf_path) ? item.pdf_path : path.join(args.root, item.pdf_path);
      if (!fs.existsSync(abs)) {
        summary.missing += 1;
        outcomes.push({ ...item, action: 'missing', reason: `not on disk: ${abs}` });
        continue;
      }

      let existing = [];
      if (args.commit) {
        const { data } = await supabase
          .from('niete_lp_assets')
          .select('id, lesson_id, asset_kind, content_hash, source_sha1, is_current')
          .eq('lesson_id', item.lesson_id);
        existing = data || [];
      }

      // Resume fast: if the render this row came from is already the current
      // asset, there is nothing to do — and no reason to spend half a second of
      // ghostscript proving it. This is what makes re-running the full corpus
      // cheap rather than a fresh 4 GB pass.
      const preSkip = planFor(item, '__unknown__', existing);
      if (args.commit && preSkip.action === 'skip' && preSkip.reason) {
        summary.skipped += 1;
        outcomes.push({ ...item, action: 'skip', reason: preSkip.reason, r2_key: preSkip.r2_key });
        continue;
      }

      const source = fs.readFileSync(abs);
      const comp = compressPdf(source, { tmpDir });
      if (!comp.compressed) { summary.uncompressed += 1; console.log(`  ~ ${item.lesson_id}: uncompressed (${comp.reason})`); }

      const hash = contentHash(comp.buffer);
      const key = r2KeyFor(item.lesson_id, hash, item.asset_kind);
      assertNewPrefix(key);

      const plan = planFor(item, hash, existing);
      summary.srcBytes += source.length;
      summary.outBytes += comp.buffer.length;
      summary[plan.action] = (summary[plan.action] || 0) + 1;
      const outcome = {
        ...item,
        action: plan.action,
        r2_key: plan.r2_key,
        content_hash: hash,
        bytes: comp.buffer.length,
        source_bytes: source.length,
        compressed: comp.compressed,
        deterministic: comp.deterministic,
        reason: plan.reason || comp.reason || null,
      };
      outcomes.push(outcome);

      if (args.r2Only) {
        // The object goes up; the row is prepared, not written. Uploading the
        // same key twice is a no-op by construction — the key IS the content.
        try {
          await r2.uploadBuffer(comp.buffer, key, 'application/pdf');
          console.log(`  ↑ ${item.lesson_id.padEnd(34)} ${(comp.buffer.length / 1048576).toFixed(2)}MB → ${key}`);
        } catch (err) {
          summary.failed += 1;
          outcome.action = 'failed';
          outcome.reason = err.message;
          console.log(`  ✗ ${item.lesson_id}: ${err.message}`);
        }
        continue;
      }
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
        outcome.action = 'failed';
        outcome.reason = err.message;
        console.log(`  ✗ ${item.lesson_id}: ${err.message}`);
      }
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }

  const skipTotal = (summary.skipped || 0) + (summary.skip || 0);
  console.log('\n--- summary ---');
  console.log(`  first=${summary.first} new_version=${summary.new_version} reinstate=${summary.reinstate} skip=${skipTotal}`);
  console.log(`  missing-on-disk=${summary.missing} failed=${summary.failed} shipped-uncompressed=${summary.uncompressed}`);
  if (summary.srcBytes) {
    console.log(`  ${(summary.srcBytes / 1048576).toFixed(0)} MB → ${(summary.outBytes / 1048576).toFixed(0)} MB (${(100 * summary.outBytes / summary.srcBytes).toFixed(1)}%)`);
  }

  // A run report, written whether the run succeeded or limped. Its job is the
  // negative space: which lessons did NOT go, and why.
  const report = buildRunReport({
    manifest: args.manifest,
    commit: args.commit,
    items: outcomes,
    survey,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  const reportDir = process.env.LP_V8_LOG_DIR || path.join(args.root, 'out', '_upload_runs');
  try {
    fs.mkdirSync(reportDir, { recursive: true });
    const stem = path.basename(pdfDirForManifest(args.manifest));
    const reportPath = path.join(
      reportDir,
      `${startedAt.replace(/[-:]/g, '').replace(/\..*/, 'Z')}_${stem}_`
        + `${args.commit ? 'commit' : (args.r2Only ? 'r2only' : 'dryrun')}.json`,
    );
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`  run report → ${reportPath}`);

    if (args.r2Only) {
      // The rows the objects are waiting for. Apply AFTER migration 018,
      // or just re-run with --commit, which redoes the same work end to end.
      const uploaded = outcomes.filter((o) => o.action !== 'failed' && o.action !== 'missing' && o.content_hash);
      const sqlPath = reportPath.replace(/\.json$/, '.sql');
      fs.writeFileSync(sqlPath, buildInsertSql(uploaded));
      console.log(`  prepared rows (${uploaded.length}) → ${sqlPath}`);
      console.log('  NOT applied. Apply after migration 018, or re-run with --commit.');
    }
  } catch (err) {
    console.log(`  ⚠ could not write the run report: ${err.message}`);
  }

  if (!args.commit) console.log('\n  DRY RUN — nothing written. Re-run with --commit.');
  if (summary.failed) process.exitCode = 1;
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
  pdfDirForManifest,
  compressPdf,
  pdfPageCount,
  planFor,
  parseArgs,
  buildRunReport,
  buildInsertSql,
  KEY_PREFIX,
  GS_SETTING,
  GS_DETERMINISTIC_FLAGS,
};
