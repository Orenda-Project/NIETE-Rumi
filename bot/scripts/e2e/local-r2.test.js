#!/usr/bin/env node
/* local-r2.test.js — the mock lane's per-run file store (bd-z3ze4.1).
 *
 * Run: node bot/scripts/e2e/local-r2.test.js   (NODE_PATH must reach @aws-sdk/client-s3 — the main checkout's)
 *
 * The bot talks to R2 through @aws-sdk/client-s3 (Put/Get/Head/Delete/ListObjectsV2 + presigned GETs) and
 * builds path-style URLs `${R2_ENDPOINT}/${bucket}/${key}`. local-r2.js stands in for it on a local run:
 *   - every WRITE (put, delete) lands in the run's own folder — never upstream;
 *   - a READ is served locally if the run wrote it, else fetched from the UPSTREAM bucket read-only
 *     (staging: the pre-rendered LP PDFs, training media and cassette mirror the seeded rows point at);
 *   - a key the run deleted stays deleted (no fall-through to upstream).
 * Hermetic: "upstream" is a second local-r2 instance with no upstream of its own.
 * Red-first: fails before local-r2.js exists.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const SERVER = path.join(__dirname, 'local-r2.js');
const BUCKET = 'niete-test-bucket';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local r2 '));   // a space, like the real repo path
const UP_PORT = 55470, LOCAL_PORT = 55471;

const start = (port, dir, env = {}) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [SERVER, String(port), dir], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; if (out.includes('listening')) resolve(p); });
  p.stderr.on('data', (d) => { out += d; });
  p.on('exit', (c) => reject(new Error(`local-r2 exited ${c}: ${out}`)));
  setTimeout(() => reject(new Error('local-r2 did not start: ' + out)), 5000);
});
const client = (port) => new S3Client({ region: 'auto', endpoint: `http://127.0.0.1:${port}`, forcePathStyle: false,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' } });
const body = async (r) => Buffer.from(await r.Body.transformToByteArray()).toString();
const listFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => !f.startsWith('.')) : []).sort();

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };

(async () => {
  const upDir = path.join(tmp, 'upstream'), localDir = path.join(tmp, 'run r2');
  const up = await start(UP_PORT, upDir);
  const upS3 = client(UP_PORT);
  // "staging" already holds a reference file the seeded rows point at
  await upS3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'lp/grade4/fractions.pdf', Body: 'UPSTREAM-PDF', ContentType: 'application/pdf' }));
  await upS3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'lp/grade4/shared.pdf', Body: 'UPSTREAM-SHARED', ContentType: 'application/pdf' }));
  const upBefore = listFiles(upDir);

  const readsLog = path.join(tmp, 'r2-reads.log');
  const local = await start(LOCAL_PORT, localDir, {
    LOCAL_R2_READ_LOG: readsLog,
    LOCAL_R2_UPSTREAM_ENDPOINT: `http://127.0.0.1:${UP_PORT}`, LOCAL_R2_UPSTREAM_BUCKET: BUCKET,
    LOCAL_R2_UPSTREAM_KEY_ID: 'local', LOCAL_R2_UPSTREAM_SECRET: 'local' });
  const s3 = client(LOCAL_PORT);
  try {
    await t('a write lands in the run folder and reads back, with its content type', async () => {
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'reports/run1/report.pdf', Body: 'RUN-PDF', ContentType: 'application/pdf' }));
      const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'reports/run1/report.pdf' }));
      assert.strictEqual(await body(r), 'RUN-PDF');
      assert.strictEqual(r.ContentType, 'application/pdf');
    });
    await t('HEAD reports a written object', async () => {
      const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: 'reports/run1/report.pdf' }));
      assert.strictEqual(h.ContentLength, 7);
    });
    await t('a key the run never wrote is read through from upstream', async () => {
      const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'lp/grade4/fractions.pdf' }));
      assert.strictEqual(await body(r), 'UPSTREAM-PDF');
    });
    await t('a presigned GET (what the bot hands WhatsApp) works through the same fall-back', async () => {
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: 'lp/grade4/fractions.pdf' }), { expiresIn: 600 });
      assert.ok(url.startsWith(`http://127.0.0.1:${LOCAL_PORT}/`), url);
      const res = await fetch(url);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(await res.text(), 'UPSTREAM-PDF');
    });
    await t('the path-style public URL the bot builds (endpoint/bucket/key) is served', async () => {
      const res = await fetch(`http://127.0.0.1:${LOCAL_PORT}/${BUCKET}/reports/run1/report.pdf`);
      assert.strictEqual(await res.text(), 'RUN-PDF');
    });
    await t('overwriting an upstream key shadows it locally — upstream keeps its own', async () => {
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'lp/grade4/shared.pdf', Body: 'RUN-SHADOW' }));
      assert.strictEqual(await body(await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'lp/grade4/shared.pdf' }))), 'RUN-SHADOW');
      assert.strictEqual(await body(await upS3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'lp/grade4/shared.pdf' }))), 'UPSTREAM-SHARED');
    });
    await t('a delete hides the key in this run, even when upstream has it — and upstream still has it', async () => {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: 'lp/grade4/fractions.pdf' }));
      await assert.rejects(s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'lp/grade4/fractions.pdf' })), (e) => e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404);
      assert.strictEqual(await body(await upS3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'lp/grade4/fractions.pdf' }))), 'UPSTREAM-PDF');
    });
    await t('a key that exists nowhere is a 404 NoSuchKey', async () => {
      await assert.rejects(s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'nope/missing.pdf' })), (e) => e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404);
    });
    await t('ListObjectsV2 merges the run\'s keys with upstream\'s, minus what the run deleted', async () => {
      const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'lp/' }));
      assert.deepStrictEqual((r.Contents || []).map((o) => o.Key).sort(), ['lp/grade4/shared.pdf']);
      const all = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
      assert.deepStrictEqual((all.Contents || []).map((o) => o.Key).sort(), ['lp/grade4/shared.pdf', 'reports/run1/report.pdf']);
    });
    await t('every read-through is logged (key + bytes) — what an offline file snapshot would need', async () => {
      const lines = fs.readFileSync(readsLog, 'utf8').trim().split('\n');
      assert.ok(lines.includes('GET\tlp/grade4/fractions.pdf\t12'), lines.join(' | '));
      assert.ok(!lines.some((l) => l.includes('reports/run1/report.pdf')), 'a file the run wrote itself is not a read-through');
    });
    await t('a BASE snapshot (seeded per machine) serves a file with NO upstream at all — offline (bd-z3ze4.5)', async () => {
      const baseDir = path.join(tmp, 'base files');
      fs.mkdirSync(path.join(baseDir, BUCKET, 'lp612/page-truth'), { recursive: true });
      fs.writeFileSync(path.join(baseDir, BUCKET, 'lp612/page-truth/g7.json'), '{"page":7}');
      const off = await start(LOCAL_PORT + 10, path.join(tmp, 'offline run'), { LOCAL_R2_BASE_DIR: baseDir, LOCAL_R2_READ_LOG: readsLog });
      try {
        const o = client(LOCAL_PORT + 10);
        assert.strictEqual(await body(await o.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'lp612/page-truth/g7.json' }))), '{"page":7}');
        const h = await o.send(new HeadObjectCommand({ Bucket: BUCKET, Key: 'lp612/page-truth/g7.json' }));
        assert.strictEqual(h.ContentLength, 10);
        await assert.rejects(o.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'lp612/page-truth/missing.json' })), (e) => e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404);
        // a base-layer hit is not a read-through: nothing went to staging
        assert.ok(!fs.readFileSync(readsLog, 'utf8').includes('g7.json'), 'a base hit must not be logged as a staging read');
        // the run can still shadow and delete a base file — the base itself is never written
        await o.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'lp612/page-truth/g7.json', Body: 'RUN' }));
        assert.strictEqual(await body(await o.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'lp612/page-truth/g7.json' }))), 'RUN');
        assert.strictEqual(fs.readFileSync(path.join(baseDir, BUCKET, 'lp612/page-truth/g7.json'), 'utf8'), '{"page":7}');
      } finally { off.kill(); }
    });
    await t('NOTHING the run did reached upstream', async () => {
      assert.deepStrictEqual(listFiles(upDir), upBefore);
    });
  } finally {
    local.kill(); up.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\nlocal-r2: ${n} passed`);
})().catch((e) => { console.error('FAIL', e.stack || e.message); process.exit(1); });
