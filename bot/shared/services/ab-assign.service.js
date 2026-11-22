// ab-assign.service.js — the one place a new A/B test picks an arm. Hash split + launch gate G1:
//   bucket = parseInt(sha256(`${salt}:${unitId}`).hex.slice(0, 8), 16) % 10000; arms take cumulative sharesBp ranges
//   in arm-key order. Identical to assign.py and sql/ab_bucket.sql (pinned by fixtures/assign_vectors.json).
// G1: a non-control arm is served only when the repo's ab/registry.json has {test_id, flag_key, card_sha256} for the
// flag (and the salt belongs to that test_id). Otherwise control and one log line per flag. A malformed or missing
// registry also serves control, and so does a flag key that does not start with ab_. A bare flag does nothing.
// The registry is read once per repo root and cached: a change to it needs a restart (a deploy).
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HEX64 = /^[0-9a-f]{64}$/;
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const logged = new WeakMap();
const cache = new Map();

function bucket(salt, unitId) {
  const hex = crypto.createHash('sha256').update(`${salt}:${unitId}`, 'utf8').digest('hex');
  return parseInt(hex.slice(0, 8), 16) % 10000;
}

function armFor(salt, unitId, sharesBp) {
  const arms = Object.keys(sharesBp).sort();
  if (arms.reduce((s, a) => s + sharesBp[a], 0) !== 10000) throw new Error('sharesBp must add up to 10000');
  const b = bucket(salt, unitId);
  let edge = 0;
  for (const a of arms) {
    edge += sharesBp[a];
    if (b < edge) return a;
  }
  throw new Error('unreachable');
}

// Returns {ok: true, entries} or {ok: false, why}. Never throws.
function readRegistry(repoRoot) {
  const file = path.join(repoRoot, 'ab', 'registry.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, why: e.code === 'ENOENT' ? 'no ab/registry.json' : 'ab/registry.json is not valid JSON' };
  }
  const entries = Array.isArray(data) ? data : data && data.tests;
  if (!Array.isArray(entries)) return { ok: false, why: 'ab/registry.json has no tests list' };
  for (const e of entries) {
    if (!e || typeof e.test_id !== 'string' || typeof e.flag_key !== 'string' || !HEX64.test(e.card_sha256 || '')) {
      return { ok: false, why: 'ab/registry.json has an entry without test_id, flag_key and a card_sha256' };
    }
  }
  return { ok: true, entries };
}

function cachedRegistry(repoRoot) {
  if (!cache.has(repoRoot)) cache.set(repoRoot, readRegistry(repoRoot));
  return cache.get(repoRoot);
}

function logOnce(log, flagKey, why) {
  let seen = logged.get(log);
  if (!seen) logged.set(log, (seen = new Set()));
  if (seen.has(flagKey)) return;
  seen.add(flagKey);
  log(`ab-assign: ${flagKey} serves control only (${why}); a frozen card must be registered first (G1)`);
}

// test = {flagKey, unitId, salt, sharesBp, controlArm}; opts = {repoRoot, log}
function assignArm(test, opts = {}) {
  const log = opts.log || ((m) => console.warn(m));
  if (!String(test.flagKey).startsWith('ab_')) {
    logOnce(log, test.flagKey, 'a test flag key must start with ab_');
    return test.controlArm;
  }
  const reg = cachedRegistry(opts.repoRoot || REPO_ROOT);
  if (!reg.ok) {
    logOnce(log, test.flagKey, reg.why);
    return test.controlArm;
  }
  const entry = reg.entries.find((e) => e.flag_key === test.flagKey);
  if (!entry || !String(test.salt).startsWith(`${entry.test_id}:`)) {
    logOnce(log, test.flagKey, entry ? 'the salt is not this test\'s' : 'no registry entry for this flag');
    return test.controlArm;
  }
  return armFor(test.salt, test.unitId, test.sharesBp);
}

module.exports = { bucket, armFor, readRegistry, assignArm, _resetCache: () => cache.clear() };
