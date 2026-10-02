#!/usr/bin/env node
/**
 * bd-mzck5 — does the R2 bucket let a browser PUT a portal upload?
 *
 * Signs a PUT exactly as portal-coaching.service does, then sends ONLY the CORS
 * preflight a browser would send first (OPTIONS — no body, so nothing is
 * written). Prints, per origin, whether the browser would be allowed to upload.
 *
 *   node scripts/ops/r2-cors-preflight.js [origin ...]
 *
 * Reads R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME from
 * the environment (e.g. `set -a; . ./.env; set +a`). Exit 1 if any origin is refused.
 * Runbook: docs/ops/r2-cors-portal-upload.md
 */
const path = require('path');
const req = (m) => require(require.resolve(m, { paths: [path.join(__dirname, '../../bot'), path.join(__dirname, '../../dashboard'), process.cwd(), ...(process.env.NODE_PATH || '').split(':').filter(Boolean)] }));
const { S3Client, PutObjectCommand } = req('@aws-sdk/client-s3');
const { getSignedUrl } = req('@aws-sdk/s3-request-presigner');

const ORIGINS = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://portal.niete.edu.pk',
  'https://portal-production-6a508.up.railway.app',
  'https://localhost',
];

(async () => {
  for (const k of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
    if (!process.env[k]) { console.error(`missing ${k}`); process.exit(2); }
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
  const url = await getSignedUrl(client, new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: 'classroom_audio/cors-probe/2026-01/portal_probe.m4a',
    ContentType: 'audio/mp4',
  }), { expiresIn: 300 });

  let refused = 0;
  for (const origin of ORIGINS) {
    const r = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' },
    });
    const allow = r.headers.get('access-control-allow-origin');
    const ok = r.ok && (allow === origin || allow === '*');
    if (!ok) refused += 1;
    console.log(`${ok ? 'ALLOWED' : 'REFUSED'}  ${origin}  (HTTP ${r.status}, allow-origin: ${allow})`);
  }
  process.exit(refused ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(2); });
