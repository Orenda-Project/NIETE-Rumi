'use strict';
/**
 * FLN media → presigned URLs on the portal's OWN private R2 bucket (COS ruling 190012 item 2; red team 190210).
 *
 * The plan bundle addresses its media on the public content mirror. That mirror rate-limits (429s measured at 1.9%
 * from ONE client), so it is not the path a teacher's browser takes. The same content-addressed keys
 * (`fln/<kind>/<sha8>/<name>`) are copied into each tier's portal bucket (R2_BUCKET_NAME), which stays private; this
 * module re-addresses every mirror URL in a served plan to a presigned GET for the SAME key on that bucket.
 *
 *   - Matched by KEY, never by host: any absolute URL whose whole path is `/fln/<kind>/<sha8>/<name>` (the mirror's
 *     form; an S3 original or an already-signed URL never has it).
 *   - Signed with the date floored to 00:00Z and the SigV4 maximum expiry (7 days): one URL per key per UTC day, so a
 *     reopened plan hits the browser cache, every cluster worker signs the same bytes, and a tab left open overnight
 *     still plays (a URL is never less than 6 days from expiry when served).
 *   - Memoised per (bucket, key, day): a plan with ~60 clips is signed once a day, not on every GET.
 *   - Fails closed: a missing bucket/credential env or a signing error leaves the plan served, with `src` moved to the
 *     item's S3 `orig` when it has one (the player's own fallback), else unchanged. Logged once per reason, plan id
 *     only (no URL, no key), once per reason per UTC day.
 *   - Never mutates its input: the corpus plan is shared by every request; the answer is a new object tree.
 *
 * Same credentials as dashboard/services/r2.service.js (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET_NAME) — nothing new on any service. Not bot/shared/storage/r2.js#getPresignedUrl: it cannot take a fixed
 * signing date, logs four lines per URL, and on an error returns the unsigned private URL (a 403 in the browser).
 */
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRES_S = 7 * 24 * 60 * 60; // SigV4 maximum
const MIRROR_KEY_RX = /^https?:\/\/[^/?#]+\/(fln\/[a-z0-9_-]+\/[0-9a-f]{8}\/[^/?#]+)$/;

let presign = getSignedUrl;
let client = null;
let clientFor = '';
let memoDay = -1;
let memo = new Map(); // `${bucket}|${key}` → signed URL, for memoDay only
const logged = new Set();
let signed = 0;

/** The bucket key of a mirror URL, or null when the URL is not one. */
function mirrorKey(url) {
  if (typeof url !== 'string') return null;
  const m = MIRROR_KEY_RX.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch (_) {
    return null;
  }
}

function config() {
  const env = process.env;
  const bucket = (env.R2_BUCKET_NAME || '').trim();
  const endpoint = (env.R2_ENDPOINT || '').trim();
  const id = env.R2_ACCESS_KEY_ID;
  const secret = env.R2_SECRET_ACCESS_KEY;
  if (!bucket) return { reason: 'no_bucket' };
  if (!endpoint || !id || !secret) return { reason: 'no_credentials' };
  return { bucket, endpoint, id, secret };
}

function r2(cfg) {
  const k = `${cfg.endpoint}|${cfg.id}`;
  if (!client || clientFor !== k) {
    client = new S3Client({ region: 'auto', endpoint: cfg.endpoint, credentials: { accessKeyId: cfg.id, secretAccessKey: cfg.secret } });
    clientFor = k;
  }
  return client;
}

// Once per reason per UTC day (not once per process): a fallback that lasts days must keep showing in the logs.
function logOnce(reason, planId, n) {
  const tag = `${reason}|${Math.floor(Date.now() / DAY_MS)}`;
  if (logged.has(tag)) return;
  logged.add(tag);
  console.error('❌ FLN media: presign unavailable, served the S3 originals', { reason, plan: planId, n });
}

async function signKey(cfg, key, day) {
  if (day !== memoDay) {
    memo = new Map();
    memoDay = day;
  }
  const mk = `${cfg.bucket}|${key}`;
  const hit = memo.get(mk);
  if (hit) return hit;
  const url = await presign(r2(cfg), new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), {
    expiresIn: EXPIRES_S,
    signingDate: new Date(day * DAY_MS),
  });
  if (typeof url !== 'string' || !url) throw new Error('empty presign');
  signed += 1;
  if (day === memoDay) memo.set(mk, url);
  return url;
}

function collectKeys(node, out) {
  if (Array.isArray(node)) {
    node.forEach((v) => collectKeys(v, out));
  } else if (node && typeof node === 'object') {
    Object.keys(node).forEach((k) => collectKeys(node[k], out));
  } else {
    const key = mirrorKey(node);
    if (key) out.add(key);
  }
  return out;
}

/** A new tree with each mirror URL replaced by its signed URL; a failed `src` falls back to a non-mirror `orig`. */
function rebuild(node, signedOf) {
  if (Array.isArray(node)) return node.map((v) => rebuild(v, signedOf));
  if (!node || typeof node !== 'object') {
    const key = mirrorKey(node);
    return key && signedOf.has(key) ? signedOf.get(key) : node;
  }
  const out = {};
  for (const k of Object.keys(node)) out[k] = rebuild(node[k], signedOf);
  const srcKey = mirrorKey(node.src);
  if (srcKey && !signedOf.has(srcKey) && typeof node.orig === 'string' && node.orig && !mirrorKey(node.orig)) {
    out.src = node.orig;
  }
  return out;
}

/**
 * The plan as served: mirror URLs presigned on the portal bucket. Never throws, never mutates `plan`.
 * @param {object} plan  the corpus plan (shared, read-only)
 * @param {string} planId  for the log line only
 */
async function servePlan(plan, planId) {
  try {
    const keys = collectKeys(plan, new Set());
    if (!keys.size) return plan;
    const cfg = config();
    const signedOf = new Map();
    if (cfg.reason) {
      logOnce(cfg.reason, planId, keys.size);
    } else {
      const day = Math.floor(Date.now() / DAY_MS);
      const list = [...keys];
      const results = await Promise.allSettled(list.map((k) => signKey(cfg, k, day)));
      let failed = 0;
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') signedOf.set(list[i], r.value);
        else failed += 1;
      });
      if (failed) logOnce('sign_error', planId, failed);
    }
    return rebuild(plan, signedOf);
  } catch (_) {
    logOnce('unexpected', planId, 0);
    try {
      return rebuild(plan, new Map());
    } catch (__) {
      return plan;
    }
  }
}

function __setPresignForTests(fn) { presign = fn || getSignedUrl; }
function __statsForTests() { return { signed, memo: memo.size, day: memoDay }; }

module.exports = { servePlan, mirrorKey, EXPIRES_S, __setPresignForTests, __statsForTests };
