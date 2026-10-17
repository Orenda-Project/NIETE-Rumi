'use strict';
/**
 * Pure rules for `scripts/rehost-legacy-training-media.js --vendor=...` (bd-s42dye.4).
 * No I/O, so they are testable without R2, Supabase or a network.
 */

const TARGET_REFS = Object.freeze({
  sandbox: 'olvritwoqujtjvwfulbh',
  staging: 'rpqkekcfvumypldbejhp',
  prod: 'ihzciabopbttygxxgrkm',
});

/**
 * Does the object at the source host need re-hosting? Only when the host would not let a browser render it
 * inline, which is the generic-binary Content-Type the third-party asset-manager buckets send on 30 of the
 * 425 legacy files. A file that already says video/mp4 or application/pdf plays from where it is.
 */
function needsRehost(contentType) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  return ct === '' || ct === 'binary/octet-stream' || ct === 'application/octet-stream';
}

/**
 * The R2 key for a re-hosted legacy module. Keyed by the FDE module id (training_modules.source_module_id), which
 * is the same in every environment, not by the target row id: staging and prod share one bucket, so a row-id key
 * could let one environment overwrite the other's object. Distinct from the bd-2666 `training/rehosted/<row id>/`.
 */
function legacyRehostKey(sourceModuleId, ext) {
  return `training/rehosted-legacy/${sourceModuleId}/${ext ? `asset.${ext}` : 'asset'}`;
}

/** Refuse to run against the wrong database (bd-2536: a worktree is seeded with another project's .env). */
function assertTarget(target, supabaseUrl) {
  const want = TARGET_REFS[target];
  if (!want) throw new Error(`ABORT: unknown --target '${target}' (sandbox | staging | prod).`);
  const m = String(supabaseUrl || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!m) throw new Error(`Unrecognized SUPABASE_URL: ${supabaseUrl}`);
  if (m[1] !== want) {
    throw new Error(`ABORT: --target ${target} expects project '${want}', the env file points at '${m[1]}'.`);
  }
  return m[1];
}

module.exports = { TARGET_REFS, needsRehost, legacyRehostKey, assertTarget };
