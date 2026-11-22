'use strict';
/**
 * bd-s0ccn5.2.2 — render every served FLN plan to a PDF and upload it to fln/pdf/<version>/<id>.pdf.
 *
 * Pictures are fetched once at render time and inlined as data:image URIs, so the PDF engine never hits the
 * public mirror (it rate-limits with 429s). A 429 or 5xx is retried with backoff, then the S3 original is tried;
 * a picture that never loads is left out of that plan — never fatal. One plan failing never stops the rest.
 * Every boundary (fetch, PDF engine, bucket) is injected so the run is testable without a browser or R2.
 *
 * CLI (operator, offline):  node scripts/fln-pdf/render.js [--force] [--only=<id,id>]
 *   env: FLN_CORPUS_FILE or FLN_CORPUS_BASE/CONTENT_R2_PUBLIC_URL + FLN_CORPUS_VERSION,
 *        R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */
const { renderFlnPlanHtml } = require('./template');
const { pdfKey } = require('./jobs');

const IMAGE_TYPE = /^image\/(png|jpe?g|webp|gif)\b/i;
const RETRYABLE = (s) => s === 429 || s >= 500;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function picturesOf(plan) {
  const out = [];
  for (const s of (plan && plan.sections) || []) {
    for (const g of s.groups || []) {
      for (const it of g.items || []) for (const m of it.media || []) if (m && m.kind === 'image' && m.src) out.push(m);
    }
  }
  return out;
}

async function fetchImage(url, { fetch, sleep, retries }) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let res;
    try {
      res = await fetch(url);
    } catch (_) {
      res = null;
    }
    if (res && res.ok) {
      const type = String((res.headers && res.headers.get('content-type')) || '');
      if (!IMAGE_TYPE.test(type)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) return null;
      return `data:${type.split(';')[0].toLowerCase()};base64,${buf.toString('base64')}`;
    }
    if (res && !RETRYABLE(res.status)) return null;
    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }
  return null;
}

/** Map of picture src → data:image URI, for every picture that loaded. */
async function inlineImages(plan, { fetch = globalThis.fetch, sleep = defaultSleep, retries = 3 } = {}) {
  const map = new Map();
  for (const m of picturesOf(plan)) {
    if (map.has(m.src)) continue;
    let uri = await fetchImage(m.src, { fetch, sleep, retries });
    if (!uri && m.orig && m.orig !== m.src) uri = await fetchImage(m.orig, { fetch, sleep, retries: 1 });
    if (uri) map.set(m.src, uri);
  }
  return map;
}

async function renderAll({ version, jobs, toPdf, store, fetch, sleep, retries, force = false, fontCss = '', log = console.log }) {
  const out = { total: jobs.length, rendered: 0, skipped: 0, failed: [] };
  for (const job of jobs) {
    try {
      const key = pdfKey(version, job.id);
      if (!force && (await store.exists(key))) {
        out.skipped += 1;
        continue;
      }
      const pics = await inlineImages(job.plan, { fetch, sleep, retries });
      const html = renderFlnPlanHtml(job.plan, { placement: job.placement, fontCss, imageSrc: (m) => pics.get(m.src) || '' });
      const pdf = await toPdf(html);
      if (!pdf || !pdf.length) throw new Error('empty PDF');
      await store.put(key, pdf, 'application/pdf');
      out.rendered += 1;
      log(`fln-pdf: ${key} (${pdf.length} B, ${pics.size}/${picturesOf(job.plan).length} pictures)`);
    } catch (e) {
      out.failed.push({ id: job.id, error: (e && e.message) || String(e) });
      log(`fln-pdf: FAILED ${job.id}: ${e && e.message}`);
    }
  }
  return out;
}

/* istanbul ignore next — operator CLI wiring; the logic above is what the tests pin. */
async function main(argv) {
  const fs = require('fs');
  const path = require('path');
  const zlib = require('zlib');
  const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
  const { htmlToPdf, closeBrowser } = require('../../bot/shared/utils/html-to-pdf');
  const { planJobs } = require('./jobs');

  const force = argv.includes('--force');
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;

  let raw;
  if (process.env.FLN_CORPUS_FILE) raw = fs.readFileSync(process.env.FLN_CORPUS_FILE);
  else {
    const base = process.env.FLN_CORPUS_BASE || `${process.env.CONTENT_R2_PUBLIC_URL}/fln/corpus`;
    const res = await fetch(`${base}/${process.env.FLN_CORPUS_VERSION}/corpus.json`);
    if (!res.ok) throw new Error(`corpus fetch ${res.status}`);
    raw = Buffer.from(await res.arrayBuffer());
  }
  if (raw[0] === 0x1f && raw[1] === 0x8b) raw = zlib.gunzipSync(raw);
  const bundle = JSON.parse(raw.toString('utf8'));
  const version = bundle.version || process.env.FLN_CORPUS_VERSION;

  const font = (f) => fs.readFileSync(path.join(__dirname, '../../bot/shared/fonts', f)).toString('base64');
  const face = (fam, f, w) => `@font-face{font-family:'${fam}';src:url(data:font/ttf;base64,${font(f)}) format('truetype');font-weight:${w}}`;
  const fontCss = [face('Lexend', 'Lexend-Regular.ttf', 400), face('Lexend', 'Lexend-Bold.ttf', 700),
    face('Noto Nastaliq Urdu', 'NotoNastaliqUrdu-Regular.ttf', 400), face('Noto Nastaliq Urdu', 'NotoNastaliqUrdu-Bold.ttf', 700)].join('');

  const s3 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  const Bucket = process.env.R2_BUCKET_NAME;
  const store = {
    exists: async (Key) => s3.send(new HeadObjectCommand({ Bucket, Key })).then(() => true, () => false),
    put: (Key, Body, ContentType) => s3.send(new PutObjectCommand({ Bucket, Key, Body, ContentType })),
  };

  const jobs = planJobs(bundle).filter((j) => !only || only.has(j.id));
  try {
    const out = await renderAll({ version, jobs, force, fontCss, store, toPdf: (h) => htmlToPdf(h, { margin: { top: '0', bottom: '0', left: '0', right: '0' } }) });
    console.log(JSON.stringify({ version, bucket: Bucket, ...out, failed: out.failed.length, failures: out.failed }, null, 2));
    if (out.failed.length) process.exitCode = 1;
  } finally {
    await closeBrowser();
  }
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });

module.exports = { renderAll, inlineImages };
