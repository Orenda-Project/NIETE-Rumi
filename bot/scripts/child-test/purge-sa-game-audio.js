#!/usr/bin/env node
'use strict';
/**
 * Remove the big flight's kept recordings (a game run's audio, kept only with web_quiz_challenge_keep_audio ON and a
 * consent on file) once they are older than the window.
 *
 *   node scripts/child-test/purge-sa-game-audio.js --env <env> [--hours N] [--apply]
 *
 * - DRY RUN IS THE DEFAULT: it lists child-test/<env>/game/ and prints how many recordings it WOULD delete.
 *   --apply deletes exactly those.
 * - --env is required and must be this deployment's own (CHILD_TEST_R2_ENV, else RAILWAY_ENVIRONMENT): two
 *   deployments can share one bucket, separated only by that prefix.
 * - --hours (default 24): a recording uploaded more than this many hours ago is past the window.
 * - Touches nothing outside child-test/<env>/game/<run>/<task>[/<item>].<ext>; the coach's recordings are never
 *   listed. Prints counts only — never a key, a run id, a name or a phone.
 * - Each deleted recording's run stops pointing at it (sa-game store-adapter forgetAudio). The dry run writes nothing.
 * - Production: --apply only on the operator's go.
 */

const EXTS = ['webm', 'ogg', 'm4a', 'mp3'];
const DEFAULT_HOURS = 24;

function parseArgs(argv) {
  const out = { env: null, hours: DEFAULT_HOURS, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--env') { out.env = argv[i + 1] || null; i += 1; }
    else if (a === '--hours') { out.hours = Number(argv[i + 1]); i += 1; }
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function deploymentEnv(env = process.env) {
  return env.CHILD_TEST_R2_ENV || env.RAILWAY_ENVIRONMENT || 'local';
}

/**
 * The purge itself. `r2` = { listObjects, deleteKey }; `forget(runId, key)` clears the run's pointer. Counts only.
 * Refuses (throws) on a missing or foreign env, or a bad window.
 */
async function purgeGameAudio({ env, hours = DEFAULT_HOURS, apply = false, r2, forget = null, ownEnv = deploymentEnv(), now = Date.now() }) {
  if (!env || !/^[a-z0-9_-]+$/i.test(env)) throw new Error('--env is required');
  if (env !== ownEnv) throw new Error(`--env ${env} is not this deployment's (${ownEnv})`);
  if (!Number.isFinite(hours) || hours < 1) throw new Error('--hours must be a number of hours, at least 1');
  const root = `child-test/${env}/game/`;
  const shape = new RegExp(`^${root.replace(/[/-]/g, '\\$&')}([0-9a-f-]{36})/[a-z]{2}\\.[a-z0-9_]+(?:/[A-Za-z0-9_.-]{1,60})?\\.(?:${EXTS.join('|')})$`);
  const cutoff = now - hours * 3600 * 1000;
  const objects = (await r2.listObjects(root)) || [];
  const out = { env, hours, apply: !!apply, listed: objects.length, matched: 0, deleted: 0, failed: 0, rows_cleared: 0 };
  for (const o of objects) {
    const m = shape.exec(String((o && o.key) || ''));
    if (!m) continue;
    const at = o.lastModified ? new Date(o.lastModified).getTime() : NaN;
    if (!Number.isFinite(at) || at > cutoff) continue;
    out.matched += 1;
    if (!apply) continue;
    try {
      if (!(await r2.deleteKey(o.key))) { out.failed += 1; continue; }
      out.deleted += 1;
      if (forget && (await forget(m[1], o.key))) out.rows_cleared += 1;
    } catch (_) { out.failed += 1; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const r2 = require('../../shared/storage/r2');
  const Store = require('../../shared/services/sa-game/store-adapter');
  const day = new Date().toISOString().slice(0, 10);
  const forget = async (runId, key) => {
    const res = await Store.forgetAudio({ sessionId: runId, key, day });
    return !!(res && res.ok && res.cleared);
  };
  const res = await purgeGameAudio({ ...args, r2, forget });
  process.stdout.write(`${JSON.stringify(res)}\n`);
  if (!args.apply) process.stdout.write(`dry run: ${res.matched} game recording(s) would be deleted; add --apply to delete them\n`);
  if (res.failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => { process.stderr.write(`refused: ${String(e && e.message || e).slice(0, 200)}\n`); process.exitCode = 2; });
}

module.exports = { purgeGameAudio, parseArgs, deploymentEnv };
