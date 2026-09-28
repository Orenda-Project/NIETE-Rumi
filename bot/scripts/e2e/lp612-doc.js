#!/usr/bin/env node
'use strict';
/**
 * lp612-doc — put or remove ONE Grades 6-12 lesson document in the lane's R2 bucket.
 *
 *   node bot/scripts/e2e/lp612-doc.js put <segment_id> <lang> <template_version> <doc.json>
 *   node bot/scripts/e2e/lp612-doc.js rm  <segment_id> <lang> <template_version>
 *
 * The 126 backfilled 6-12 deliveries on the sandbox point at renders whose documents live in
 * another bucket (NoSuchKey here, run 20260927-1923), so a seeded delivery carries its OWN
 * template_version (qa-v1) and this puts the document the worker's lp612-quiz-source reads under
 * exactly the key the product computes (lp612-serving.docKeyFor). Mock lane only; refuses the
 * production project; the key namespace is the seed's, never a real render's.
 */
const path = require('path');
const fs = require('fs');
const root = process.cwd();
const envFile = fs.existsSync(path.join(root, '.env')) ? path.join(root, '.env') : path.join(root, 'bot', '.env');
require(path.join(root, 'bot', 'node_modules', 'dotenv')).config({ path: envFile });
if (String(process.env.SUPABASE_URL || '').includes('ihzciabopbttygxxgrkm')) { console.error('lp612-doc: refusing the NIETE production project'); process.exit(3); }
const [mode, segment, lang, tv, file] = process.argv.slice(2);
if (!mode || !segment || !lang || !tv || (mode === 'put' && !file)) { console.error('usage: lp612-doc.js put|rm <segment_id> <lang> <template_version> [doc.json]'); process.exit(2); }
if (!/^qa-/.test(tv)) { console.error('lp612-doc: template_version must start with qa- (never a real render key)'); process.exit(2); }
(async () => {
  const Serving = require(path.join(root, 'bot', 'shared', 'services', 'lp612-serving.service'));
  const key = Serving.docKeyFor(segment, lang, tv);
  const { S3Client, PutObjectCommand, DeleteObjectCommand } = require(path.join(root, 'bot', 'node_modules', '@aws-sdk', 'client-s3'));
  const s3 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  if (mode === 'put') {
    const body = fs.readFileSync(file);
    JSON.parse(body.toString('utf8'));
    await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: body, ContentType: 'application/json' }));
    console.log(JSON.stringify({ ok: true, mode, key, bytes: body.length }));
  } else if (mode === 'rm') {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    console.log(JSON.stringify({ ok: true, mode, key }));
  } else { console.error('lp612-doc: mode must be put|rm'); process.exit(2); }
})().catch((e) => { console.error(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
