#!/usr/bin/env node
'use strict';
/**
 * Remove the Challenge's KEPT readings (web_quiz_challenge_keep_audio) from the private child-voice bucket.
 *
 *   node scripts/quiz/purge-kept-child-voice.js --env <env> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--apply]
 *
 * - DRY RUN IS THE DEFAULT: it lists child-voice/<env>/kept/ and prints how many readings it WOULD delete,
 *   per upload day. --apply deletes exactly those.
 * - --env is required and must be this deployment's own (CHILD_TEST_R2_ENV, else RAILWAY_ENVIRONMENT): two
 *   deployments can share one bucket, separated only by that prefix.
 * - --from / --to (inclusive, UTC upload day) narrow it; without them every kept reading of the env.
 * - Touches nothing outside child-voice/<env>/kept/<YYYY-MM-DD>/<run>/<file>. Prints counts only — never a key,
 *   a run id, a name or a phone.
 * - Each deleted reading's run row stops pointing at it (meta.audio_key null, meta.audio_purged_on the day). The dry
 *   run writes nothing anywhere.
 * - Production: --apply only on the operator's go (the runbook says who runs it).
 */

const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(argv) {
  const out = { env: null, from: null, to: null, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--env' || a === '--from' || a === '--to') { out[a.slice(2)] = argv[i + 1] || null; i += 1; }
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function deploymentEnv(env = process.env) {
  return env.CHILD_TEST_R2_ENV || env.RAILWAY_ENVIRONMENT || 'local';
}

/**
 * The purge itself. `r2` = { listKeys, deleteKey }; `bucket` = the child-voice bucket. Returns counts only.
 * Refuses (throws) on a missing or foreign env, or a malformed day.
 */
async function purgeKept({ env, from = null, to = null, apply = false, r2, bucket, clearRow = null, ownEnv = deploymentEnv() }) {
  if (!env || !/^[a-z0-9_-]+$/i.test(env)) throw new Error('--env is required');
  if (env !== ownEnv) throw new Error(`--env ${env} is not this deployment's (${ownEnv})`);
  for (const d of [from, to]) if (d != null && !DAY_RX.test(d)) throw new Error('--from/--to must be YYYY-MM-DD');
  if (from && to && from > to) throw new Error('--from is after --to');
  const root = `child-voice/${env}/kept/`;
  const shape = new RegExp(`^${root.replace(/[/-]/g, '\\$&')}(\\d{4}-\\d{2}-\\d{2})/([^/]+)/[^/]+$`);
  const keys = (await r2.listKeys(root, { bucket })) || [];
  const out = { env, from, to, apply: !!apply, listed: keys.length, matched: 0, by_day: {}, deleted: 0, failed: 0, rows_cleared: 0 };
  for (const k of keys) {
    const m = shape.exec(String(k || ''));
    if (!m) continue;
    const day = m[1];
    if ((from && day < from) || (to && day > to)) continue;
    out.matched += 1;
    out.by_day[day] = (out.by_day[day] || 0) + 1;
    if (!apply) continue;
    try {
      if (!(await r2.deleteKey(k, { bucket }))) { out.failed += 1; continue; }
      out.deleted += 1;
      if (clearRow && (await clearRow(m[2], k))) out.rows_cleared += 1;
    } catch (_) { out.failed += 1; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const r2 = require('../../shared/storage/r2');
  const { childVoiceBucket, forgetAudioKey } = require('../../shared/services/quiz/web-quiz-challenge');
  const res = await purgeKept({ ...args, r2, bucket: childVoiceBucket(), clearRow: (runId, key) => forgetAudioKey(runId, key) });
  process.stdout.write(`${JSON.stringify(res)}\n`);
  if (!args.apply) process.stdout.write(`dry run: ${res.matched} kept reading(s) would be deleted; add --apply to delete them\n`);
  if (res.failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => { process.stderr.write(`refused: ${String(e && e.message || e).slice(0, 200)}\n`); process.exitCode = 2; });
}

module.exports = { purgeKept, parseArgs, deploymentEnv };
