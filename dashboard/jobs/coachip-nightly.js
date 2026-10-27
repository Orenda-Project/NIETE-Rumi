#!/usr/bin/env node
'use strict';
/**
 * COACHIP nightly insight job (bd-sex15q.14; contract NIGHTLY_JOB.md v1).
 *   node dashboard/jobs/coachip-nightly.js --date YYYY-MM-DD [--dry-run] [--scope coach:<uuid>|school:<uuid>|sector:<name>]
 *     [--stages a,b] [--no-models] [--dry-run-models <usd>] [--backfill-budget <usd>] [--reconcile] [--purge-clips] [--out <dir>]
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, COACHIP_ENV (sandbox|staging|production), COACHIP_TEACHER_KEY_SECRET,
 * OPENROUTER_API_KEY, R2_*, DATABASE_URL (the run lock; safe through the 6543 transaction pooler), COACHIP_PURGE_ACTOR_USER_ID
 * (write-mode --purge-clips: the staff user the purge's audit row names; lib/insights/purge.js). Exit: 0 ok/partial · 2 failed after facts · 3 env refused · 4 lock held.
 * The environment is asserted before any client is built; a dry run builds a read-only client and writes only to --out.
 */
const path = require('path');
const crypto = require('crypto');
const env = require('../lib/insights/env');

// 'purge' runs only with --purge-clips; `--stages purge` alone skips the insight stages (a purge-only hand run).
const STAGES = ['facts', 'signals', 'moments', 'legs', 'models', 'rollups', 'ranking', 'circle', 'recheck', 'drift', 'clips', 'purge'];

function parseArgs(argv) {
  const o = { date: null, dryRun: false, scope: null, stages: null, noModels: false, dryRunModelsUsd: 0, backfillBudgetUsd: 0,
    reconcile: false, purgeClips: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => { i += 1; if (i >= argv.length) throw new Error(`${a} needs a value`); return argv[i]; };
    if (a === '--date') o.date = next();
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--scope') o.scope = next();
    else if (a === '--stages') o.stages = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--no-models') o.noModels = true;
    else if (a === '--dry-run-models') o.dryRunModelsUsd = Number(next());
    else if (a === '--backfill-budget') o.backfillBudgetUsd = Number(next());
    else if (a === '--reconcile') o.reconcile = true;
    else if (a === '--purge-clips') o.purgeClips = true;
    else if (a === '--out') o.out = next();
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.date && !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new Error('--date must be YYYY-MM-DD');
  if (o.scope && !/^(coach:[0-9a-f-]{36}|school:[0-9a-f-]{36}|sector:.+)$/.test(o.scope)) throw new Error('--scope is coach:<uuid>, school:<uuid> or sector:<name>');
  if (o.stages && o.stages.some((s) => !STAGES.includes(s))) throw new Error(`--stages from ${STAGES.join(',')}`);
  if (!Number.isFinite(o.dryRunModelsUsd) || o.dryRunModelsUsd < 0 || o.dryRunModelsUsd > 1) throw new Error('--dry-run-models is 0..1 USD (the lane budget)');
  if (!Number.isFinite(o.backfillBudgetUsd) || o.backfillBudgetUsd < 0) throw new Error('--backfill-budget must be >= 0');
  if (o.stages && o.stages.includes('purge') && !o.purgeClips) throw new Error('--stages purge needs --purge-clips');
  return o;
}

const purgeOnly = (o) => !!(o.stages && o.stages.length && o.stages.every((s) => s === 'purge'));

/** Retention A after the run (or alone, `--stages purge`): counts to the log and to <out>/purge.json, never a key. */
async function purgeStage(opts, { envName, store, e, out, log }) {
  const purge = require('../lib/insights/purge');
  const win = require('../lib/insights/windows');
  const fs = require('fs');
  const counts = await purge.runPurge({ envName, bucket: e.COACHIP_CLIP_BUCKET || e.R2_BUCKET_NAME, s3: purge.r2PurgeFromEnv(e), store,
    today: win.addDays(opts.date, 1), dryRun: opts.dryRun, actorUserId: e.COACHIP_PURGE_ACTOR_USER_ID, log });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'purge.json'), JSON.stringify({ ...counts, run_id: undefined }, null, 1));
  return counts;
}

/** The Karachi date at start, minus one day (NIGHTLY_JOB §0). */
function defaultDate(now = new Date()) {
  const k = new Date(now.getTime() + 5 * 3600 * 1000);
  k.setUTCDate(k.getUTCDate() - 1);
  return k.toISOString().slice(0, 10);
}

/** Runs `fn` holding the one-run-at-a-time lock (NIGHTLY_JOB §0) on `pg`, released in `finally`; exit 4 when another run holds it. */
async function withRunLock(pg, log, fn) {
  const store = require('../lib/insights/store');
  const lock = await store.acquireLock(pg, { onLost: () => log('lock_lost') });
  if (!lock) { log('already running'); return 4; }
  try {
    return await fn();
  } finally {
    await lock.release().catch(() => log('lock_release_failed'));
  }
}

async function main(argv = process.argv.slice(2), e = process.env, log = (m) => console.log(`[coachip-nightly] ${m}`)) {
  let opts;
  try { opts = parseArgs(argv); } catch (err) { log(`usage: ${err.message}`); return 64; }
  opts.date = opts.date || defaultDate();
  let asserted;
  try {
    asserted = env.assertEnvironment({ supabaseUrl: e.SUPABASE_URL, databaseUrl: e.DATABASE_URL, coachipEnv: e.COACHIP_ENV,
      dryRun: opts.dryRun, bucket: opts.dryRun ? undefined : e.COACHIP_CLIP_BUCKET || e.R2_BUCKET_NAME });
  } catch (err) {
    if (err instanceof env.EnvRefusal) { log('env_mismatch'); return 3; }
    throw err;
  }
  // Every purge that deletes writes an audit row, and the row needs a person (coachip_audit_log.actor_user_id).
  if (opts.purgeClips && !opts.dryRun && !e.COACHIP_PURGE_ACTOR_USER_ID) { log('purge_refused reason=no_actor'); return 3; }
  const { createClient } = require('@supabase/supabase-js');
  const raw = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY || e.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const { runJob } = require('../lib/insights/job');
  const store = require('../lib/insights/store');
  const out = opts.out || path.resolve(process.cwd(), `coachip-dryrun-${opts.date}`);
  const thenPurge = async (code, purgeStore) => {
    if (!opts.purgeClips || code !== 0) return code;
    try {
      await purgeStage(opts, { envName: asserted.env, store: purgeStore, e, out, log });
      return 0;
    } catch (err) {
      const { PurgeRefusal } = require('../lib/insights/purge');
      if (err instanceof PurgeRefusal) { log(`purge_refused reason=${err.reason.replace(/\W+/g, '_')}`); return 3; }
      log(`purge_failed error=${err && err.name}`);
      return 2;
    }
  };
  if (opts.dryRun) {
    const code = purgeOnly(opts) ? 0 : await runJob(opts, {
      mode: 'read_only', envName: asserted.env, ref: asserted.ref, readClient: env.readOnlyClient(raw), store: new store.MemoryStore(),
      // A dry run mints throwaway keys: nothing it writes can be joined to a stored code.
      secret: crypto.randomBytes(32).toString('hex'), out, log, apiKey: e.OPENROUTER_API_KEY,
    });
    // The purge's dry run reads the coachip_ tables (when each session was last shown) through a store that refuses writes.
    return thenPurge(code, require('../lib/insights/purge').readOnlyStore(new store.SupabaseStore(raw)));
  }
  if (!purgeOnly(opts) && !e.COACHIP_TEACHER_KEY_SECRET) { log('missing COACHIP_TEACHER_KEY_SECRET'); return 3; }
  const { Client } = require('pg');
  const pg = new Client({ connectionString: e.DATABASE_URL });
  await pg.connect();
  try {
    return await withRunLock(pg, log, async () => {
      const clipBucket = e.COACHIP_CLIP_BUCKET || e.R2_BUCKET_NAME;
      let clipper = null;
      if (e.R2_ENDPOINT && clipBucket) {
        const { createClipper, r2FromEnv } = require('../lib/insights/clip-stage');
        clipper = createClipper({ envName: asserted.env, bucket: clipBucket, ...r2FromEnv(e) });
      }
      const code = purgeOnly(opts) ? 0 : await runJob(opts, {
        mode: 'write', envName: asserted.env, ref: asserted.ref, readClient: raw, store: new store.SupabaseStore(raw),
        secret: e.COACHIP_TEACHER_KEY_SECRET, out, log, apiKey: e.OPENROUTER_API_KEY, clipper,
      });
      // Inside the run lock: a purge never races the clip stage of another run.
      return thenPurge(code, new store.SupabaseStore(raw));
    });
  } finally {
    await pg.end().catch(() => {});
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`[coachip-nightly] failed: ${err && err.name}`);
    process.exitCode = 2;
  });
}

module.exports = { main, parseArgs, defaultDate, withRunLock, purgeOnly, STAGES };
