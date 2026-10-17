#!/usr/bin/env node
/**
 * bd-2666 / sheet R3 — re-host legacy training media onto R2.
 *
 * WHY THIS EXISTS
 * ---------------
 * 213 of 384 active training modules still point at the third-party buckets
 * `asset-manager-approved` / `asset-manager-in-review`
 * (.s3.ap-south-1.amazonaws.com). Measured against the live corpus on
 * 2026-08-13, 212 of those 213 return:
 *
 *     Content-Type: binary/octet-stream
 *     Content-Disposition: (absent)
 *
 * No browser renders `binary/octet-stream` inline, so tapping a training link
 * prompts a download. Note what is NOT happening: nothing sets "attachment".
 * Adding a disposition header would change nothing — the dashboard already
 * discovered this (dashboard/services/r2.service.js:249, "Forcing inline with
 * application/octet-stream downloads anyway").
 *
 * We cannot fix the header at the source: we do not own those buckets, and
 * getPresignedUrl() refuses to sign a non-R2 URL (isPermanentR2Url,
 * bot/shared/storage/r2.js:611) — it returns the raw link untouched. The only
 * durable fix is to re-host onto R2 with a correct ContentType, which is what
 * the schema always planned for: training_modules.source_media_url is
 * commented "original Taleemabad URL, retained until re-hosted".
 *
 * WHAT IT DOES
 * ------------
 * For each affected module: stream the source object -> R2 (correct
 * ContentType, derived from the file extension) -> update the row to point at
 * the R2 URL. `source_media_url` is deliberately PRESERVED as the provenance
 * record; only the column the bot actually delivers from is repointed.
 *
 * SAFETY
 * ------
 *  - Dry-run by default. Pass --apply to write.
 *  - Aborts unless SUPABASE_URL is the NIETE project (the worktree .env trap,
 *    bd-2536: a worktree is seeded with the MAIN BOT's .env, which points at a
 *    different production database).
 *  - Idempotent: a module already on a controlled host is skipped, so a re-run
 *    after a partial failure resumes rather than duplicating.
 *  - Verifies each upload by re-reading the object's Content-Type from R2
 *    before the DB is touched. A row is only repointed at an asset proven to
 *    serve renderable bytes.
 *  - Never deletes anything from the source bucket.
 *
 * USAGE
 *   node scripts/rehost-legacy-training-media.js              # dry run
 *   node scripts/rehost-legacy-training-media.js --apply
 *   node scripts/rehost-legacy-training-media.js --apply --only=pdf
 *   node scripts/rehost-legacy-training-media.js --apply --limit=5
 *
 * bd-s42dye.4 — the legacy "Taleemabad" provider (vendor TALEEMABAD_LEGACY):
 *   node scripts/rehost-legacy-training-media.js --target=sandbox --env-file=<sandbox.env> \
 *        --vendor=TALEEMABAD_LEGACY --only-bad-content-type            # dry run
 *   ... --apply
 *   --target      sandbox | staging | prod (default prod, as before); the project ref is asserted.
 *   --env-file    the TARGET's env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_*). Default: repo .env.
 *   --vendor      only that vendor's modules. Objects go to training/rehosted-legacy/<fde module id>/ (same key in
 *                 every environment: staging and prod share one bucket) and an object already there is reused.
 *   --only-bad-content-type   HEAD each source first and re-host only a generic-binary Content-Type.
 */

// Runtime deps live in bot/node_modules (the repo root has none) — resolve
// through it, the same way scripts/verify-partition-bd2102.js does.
const path = require('path');
const fromBot = (mod) => require(path.join(__dirname, '..', 'bot', 'node_modules', mod));

const args = process.argv.slice(2);
const argValue = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || null;
const ENV_FILE = argValue('env-file') || path.join(__dirname, '..', '.env');
fromBot('dotenv').config({ path: ENV_FILE, quiet: true });

const https = require('https');
const { createClient } = fromBot('@supabase/supabase-js');
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = fromBot('@aws-sdk/client-s3');
const {
  isPdfModule,
  effectiveMediaUrl,
  isControlledMediaHost,
} = require('../bot/shared/services/training/media-host');
const { needsRehost, legacyRehostKey, assertTarget } = require('./lib/legacy-media-rehost.rules');

const BUCKET = process.env.R2_BUCKET_NAME;
// R2 multipart requires every part except the last to be >= 5 MiB.
const PART_SIZE = 16 * 1024 * 1024;
// Buffer small files in one shot; stream anything above this.
const SINGLE_SHOT_MAX = 24 * 1024 * 1024;

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

const APPLY = args.includes('--apply');
const TARGET = argValue('target') || 'prod';
const VENDOR = argValue('vendor');
const ONLY_BAD_CT = args.includes('--only-bad-content-type');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;

/**
 * Refuse to run against the wrong database (bd-2536). The env file's project ref must match --target
 * (default prod, the original behaviour).
 */
function assertNieteTarget() {
  return assertTarget(TARGET, process.env.SUPABASE_URL);
}

function extensionOf(url) {
  try {
    const p = new URL(url).pathname;
    return p.includes('.') ? p.split('.').pop().toLowerCase() : '';
  } catch {
    return '';
  }
}

function contentTypeFor(url) {
  return CONTENT_TYPES[extensionOf(url)] || null;
}

/** GET the source object, following redirects, exposing headers + stream. */
function fetchSource(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 120000 }, (res) => {
      const { statusCode, headers } = res;
      if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        return resolve(fetchSource(new URL(headers.location, url).toString(), redirectsLeft - 1));
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`source returned HTTP ${statusCode}`));
      }
      resolve({ stream: res, length: Number(headers['content-length']) || 0 });
    });
    req.on('timeout', () => req.destroy(new Error('source timeout')));
    req.on('error', reject);
  });
}

/** HEAD the source object: its Content-Type (undefined when absent), following redirects. */
function headSource(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD', timeout: 30000 }, (res) => {
      const { statusCode, headers } = res;
      res.resume();
      if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        return resolve(headSource(new URL(headers.location, url).toString(), redirectsLeft - 1));
      }
      if (statusCode !== 200) return reject(new Error(`source HEAD returned HTTP ${statusCode}`));
      resolve(headers['content-type']);
    });
    req.on('timeout', () => req.destroy(new Error('source HEAD timeout')));
    req.on('error', reject);
    req.end();
  });
}

function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Pull exactly `size` bytes off a readable (fewer only at EOF), returning null
 * once the stream is exhausted.
 *
 * NOT written with `for await ... break`: breaking out of a for-await loop
 * calls the iterator's return(), which DESTROYS the underlying HTTP response.
 * That silently killed the source connection after the first 16 MB part and
 * surfaced only as "aborted" on every video. Using the event API keeps one
 * response alive across all parts of a multipart upload.
 */
function readChunk(stream, size) {
  return new Promise((resolve, reject) => {
    if (stream.readableEnded && !stream.readable) return resolve(null);

    const attempt = () => {
      // readable.read(n) returns null when fewer than n bytes are buffered;
      // wait for more rather than treating a short buffer as EOF.
      const exact = stream.read(size);
      if (exact) return finish(exact);
      const rest = stream.read();
      if (rest) return finish(rest);
      return false;
    };
    const finish = (buf) => {
      cleanup();
      resolve(buf);
      return true;
    };
    const onReadable = () => { attempt(); };
    const onEnd = () => { cleanup(); resolve(null); };
    const onErr = (e) => { cleanup(); reject(e); };
    function cleanup() {
      stream.removeListener('readable', onReadable);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onErr);
    }

    stream.on('readable', onReadable);
    stream.on('end', onEnd);
    stream.on('error', onErr);
    attempt();
  });
}

/**
 * Stream source -> R2. Small objects go in a single PutObject; large ones use
 * multipart so a 703 MB video never has to sit in memory at once.
 */
async function uploadToR2(client, key, contentType, source) {
  if (source.length && source.length <= SINGLE_SHOT_MAX) {
    const chunks = [];
    for await (const c of source.stream) chunks.push(c);
    const body = Buffer.concat(chunks);
    await client.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType })
    );
    return body.length;
  }

  const created = await client.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType })
  );
  const uploadId = created.UploadId;
  const parts = [];
  let total = 0;

  try {
    let partNumber = 1;
    for (;;) {
      // Accumulate to a FULL part before uploading: read() can legitimately
      // return a short buffer mid-stream, and R2 rejects any part below 5 MiB
      // unless it is the final one.
      const pieces = [];
      let filled = 0;
      while (filled < PART_SIZE) {
        const piece = await readChunk(source.stream, PART_SIZE - filled);
        if (!piece || !piece.length) break;
        pieces.push(piece);
        filled += piece.length;
      }
      const buf = pieces.length ? Buffer.concat(pieces, filled) : null;
      if (!buf || !buf.length) break;

      const res = await client.send(
        new UploadPartCommand({
          Bucket: BUCKET,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: buf,
        })
      );
      parts.push({ ETag: res.ETag, PartNumber: partNumber });
      total += buf.length;
      process.stdout.write(`\r      part ${partNumber} · ${(total / 1e6).toFixed(0)} MB`);
      partNumber += 1;
    }

    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: BUCKET,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      })
    );
    process.stdout.write('\r');
    return total;
  } catch (err) {
    // Leaving an incomplete multipart upload behind bills storage forever.
    await client
      .send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }))
      .catch(() => {});
    throw err;
  }
}

async function main() {
  const ref = assertNieteTarget();
  for (const k of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
    if (!process.env[k]) throw new Error(`Missing required env var ${k}`);
  }

  console.log(`\nbd-2666 — re-host legacy training media`);
  console.log(`  supabase : ${ref} (--target ${TARGET})`);
  if (VENDOR) console.log(`  vendor   : ${VENDOR}${ONLY_BAD_CT ? ' · only generic-binary Content-Type' : ''}`);
  console.log(`  bucket   : ${BUCKET}`);
  console.log(`  mode     : ${APPLY ? 'APPLY (writes R2 + DB)' : 'DRY RUN (no writes)'}`);
  if (ONLY) console.log(`  filter   : ${ONLY} only`);

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const base = sb.from('training_modules');
  const { data, error } = VENDOR
    ? await base
        .select('id,source_module_id,title,video_url,source_media_url,is_active,training_courses!inner(training_levels!inner(training_vendors!inner(key)))')
        .eq('is_active', true)
        .eq('training_courses.training_levels.training_vendors.key', VENDOR)
        .limit(2000)
    : await base.select('id,title,video_url,source_media_url,is_active').eq('is_active', true).limit(2000);
  if (error) throw new Error(`module fetch failed: ${error.message}`);

  let candidates = data
    .map((m) => ({ m, url: effectiveMediaUrl(m), kind: isPdfModule(m) ? 'pdf' : 'video' }))
    .filter((c) => c.url && !isControlledMediaHost(c.url));
  if (ONLY) candidates = candidates.filter((c) => c.kind === ONLY);
  if (ONLY_BAD_CT) {
    const kept = [];
    for (const c of candidates) {
      try {
        if (needsRehost(await headSource(c.url))) kept.push(c);
      } catch (err) {
        console.log(`  ⚠️  module ${c.m.id}: HEAD failed (${err.message}), treated as needing a re-host`);
        kept.push(c);
      }
    }
    console.log(`  ${candidates.length - kept.length} of ${candidates.length} already serve a renderable Content-Type and stay put`);
    candidates = kept;
  }
  candidates = candidates.slice(0, LIMIT);

  console.log(`\n  ${candidates.length} module(s) on an uncontrolled host\n`);
  if (!candidates.length) {
    console.log('  Nothing to do — every deliverable module is already on R2.\n');
    return;
  }

  if (!APPLY) {
    for (const c of candidates.slice(0, 15)) {
      console.log(`   [${c.kind}] module ${c.m.id} · ${String(c.m.title).slice(0, 52)}`);
      console.log(`         ${c.url.slice(0, 100)}`);
    }
    if (candidates.length > 15) console.log(`   … and ${candidates.length - 15} more`);
    console.log(`\n  Dry run — re-run with --apply to perform the migration.\n`);
    return;
  }

  const client = r2Client();
  const failures = [];
  let done = 0;

  for (const [i, c] of candidates.entries()) {
    const { m, url, kind } = c;
    const label = `[${i + 1}/${candidates.length}] module ${m.id} (${kind})`;
    const contentType = contentTypeFor(url);
    if (!contentType) {
      console.log(`  ⏭️  ${label} — unknown extension, skipped: ${url.slice(0, 70)}`);
      failures.push({ id: m.id, reason: 'unknown extension' });
      continue;
    }

    const ext = extensionOf(url);
    const key = VENDOR
      ? legacyRehostKey(m.source_module_id, ext)
      : `training/rehosted/${m.id}/${extensionOf(url) ? `asset.${ext}` : 'asset'}`;

    try {
      console.log(`  ⏳ ${label} · ${String(m.title).slice(0, 44)}`);
      // A legacy object another environment already put at this key (shared bucket) is reused, not re-uploaded.
      let bytes = 0;
      const already = VENDOR
        ? await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => null)
        : null;
      if (already && already.ContentType === contentType) {
        bytes = Number(already.ContentLength) || 0;
        console.log(`      reusing existing object ${key}`);
      } else {
        const source = await fetchSource(url);
        bytes = await uploadToR2(client, key, contentType, source);
      }

      // Prove the object is really there and really renderable BEFORE the DB
      // is repointed — "uploaded" is a hypothesis until R2 confirms the type.
      const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      if (head.ContentType !== contentType) {
        throw new Error(`verify failed: R2 reports ContentType=${head.ContentType}`);
      }

      const newUrl = `${process.env.R2_ENDPOINT}/${BUCKET}/${key}`;
      // Repoint only the delivered column; source_media_url stays as provenance.
      const patch = kind === 'pdf' ? { source_media_url: newUrl } : { video_url: newUrl };
      const { error: upErr } = await sb.from('training_modules').update(patch).eq('id', m.id);
      if (upErr) throw new Error(`db update failed: ${upErr.message}`);

      done += 1;
      console.log(`  ✅ ${label} · ${(bytes / 1e6).toFixed(1)} MB · ${contentType}`);
    } catch (err) {
      console.log(`  ❌ ${label} — ${err.message}`);
      failures.push({ id: m.id, reason: err.message });
    }
  }

  console.log(`\n  migrated: ${done}/${candidates.length}`);
  if (failures.length) {
    console.log(`  failed:   ${failures.length}`);
    for (const f of failures) console.log(`    module ${f.id}: ${f.reason}`);
    console.log(`\n  Re-run the script to retry only the failures (already-migrated rows are skipped).`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
