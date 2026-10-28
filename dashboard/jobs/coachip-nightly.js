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
 * DB and R2 safety (bd-sex15q.41; lib/insights/safety.js), all optional except the first on production:
 *   COACHIP_READ_SUPABASE_URL   the read replica's REST URL: every source read goes there (REQUIRED on production; else the primary)
 *   COACHIP_DB_MAX_INFLIGHT     PostgREST requests in flight to the primary, 1..2 (default 2; with the lock connection, ≤ 3 in all)
 *   COACHIP_READ_MAX_INFLIGHT   requests in flight to the read URL, 1..2 (default 2)
 *   COACHIP_HTTP_TIMEOUT_MS     every PostgREST request's budget (default 60000)
 *   COACHIP_R2_CONCURRENCY      clip cuts and uploads at once, 1..4 (default 2)
 *   COACHIP_NIGHT_END_UTC       the end of night, HH:MM UTC (default 00:50 = 05:50 PKT); stage cut-offs before it (safety.STAGE_CUTOFF_MIN)
 *   COACHIP_HEALTH_GUARD        1 = the abort rule on (always on for production); COACHIP_ABORT_SWAP_MB / _MEMAVAIL_MB / _LAG_S override it
 *   COACHIP_MODEL_CONCURRENCY   phonics and gloss model calls at once, 1..12 (default 1; 12 spends the US$21 backfill in one night,
 *                               bd-sex15q.43). The database is unaffected: its requests stay bounded by COACHIP_DB_MAX_INFLIGHT
 * A production run never starts in school hours (03:00-12:00Z): exit 3.
 */
const path = require('path');
const crypto = require('crypto');
const env = require('../lib/insights/env');
const safety = require('../lib/insights/safety');

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

const clampInt = (v, lo, hi, dflt) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && v !== '' && v != null ? Math.min(hi, Math.max(lo, n)) : dflt; };

/** The knobs, read once (names in the header). */
function safetyConfig(e) {
  const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
  return {
    dbInflight: clampInt(e.COACHIP_DB_MAX_INFLIGHT, 1, 2, 2),
    readInflight: clampInt(e.COACHIP_READ_MAX_INFLIGHT, 1, 2, 2),
    timeoutMs: clampInt(e.COACHIP_HTTP_TIMEOUT_MS, 5000, 300000, 60000),
    r2Concurrency: clampInt(e.COACHIP_R2_CONCURRENCY, 1, 4, 2),
    modelConcurrency: clampInt(e.COACHIP_MODEL_CONCURRENCY, 1, 12, 1),
    nightEndUtc: e.COACHIP_NIGHT_END_UTC || safety.DEFAULT_NIGHT_END_UTC,
    thresholds: { swapUsedMb: num(e.COACHIP_ABORT_SWAP_MB), memAvailableMb: num(e.COACHIP_ABORT_MEMAVAIL_MB), replicaLagS: num(e.COACHIP_ABORT_LAG_S) },
  };
}

/** The run-lock connection: a client-side query timeout and a connect timeout, never a session SET (the pooler rule). */
function pgConfig(e) {
  return { connectionString: e.DATABASE_URL, query_timeout: 30000, connectionTimeoutMillis: 15000 };
}

async function main(argv = process.argv.slice(2), e = process.env, log = (m) => console.log(`[coachip-nightly] ${m}`), sys = {}) {
  let opts;
  try { opts = parseArgs(argv); } catch (err) { log(`usage: ${err.message}`); return 64; }
  const now = sys.now ? sys.now() : new Date();
  const netFetch = sys.fetch || globalThis.fetch;
  opts.date = opts.date || defaultDate(now);
  let asserted;
  try {
    asserted = env.assertEnvironment({ supabaseUrl: e.SUPABASE_URL, databaseUrl: e.DATABASE_URL, coachipEnv: e.COACHIP_ENV,
      dryRun: opts.dryRun, bucket: opts.dryRun ? undefined : e.COACHIP_CLIP_BUCKET || e.R2_BUCKET_NAME });
  } catch (err) {
    if (err instanceof env.EnvRefusal) { log('env_mismatch'); return 3; }
    throw err;
  }
  const prod = asserted.env === 'production';
  // COS 28 Oct 12:17Z: nothing of ours touches prod (primary or replica) while schools are recording.
  if (prod && safety.inSchoolHours(now)) { log('refused reason=school_hours'); return 3; }
  let read;
  try {
    read = env.resolveReadUrl({ coachipEnv: asserted.env, supabaseUrl: e.SUPABASE_URL, readUrl: e.COACHIP_READ_SUPABASE_URL });
  } catch (err) {
    if (err instanceof env.EnvRefusal) { log(`refused reason=${prod && !e.COACHIP_READ_SUPABASE_URL ? 'no_replica' : 'replica_mismatch'}`); return 3; }
    throw err;
  }
  // Every purge that deletes writes an audit row, and the row needs a person (coachip_audit_log.actor_user_id).
  if (opts.purgeClips && !opts.dryRun && !e.COACHIP_PURGE_ACTOR_USER_ID) { log('purge_refused reason=no_actor'); return 3; }
  const cfg = safetyConfig(e);
  const deadlines = safety.nightDeadlines(now, cfg.nightEndUtc);
  const healthOn = prod || e.COACHIP_HEALTH_GUARD === '1';
  const health = healthOn ? safety.createHealthGuard({ fetch: netFetch, primaryUrl: e.SUPABASE_URL, key: e.SUPABASE_SERVICE_ROLE_KEY || e.SUPABASE_SERVICE_KEY,
    replicaUrl: read.source === 'replica' ? read.url : null, thresholds: cfg.thresholds }) : null;
  log(`safety read=${read.source} db_inflight=${cfg.dbInflight} read_inflight=${cfg.readInflight} timeout_ms=${cfg.timeoutMs} `
    + `r2_concurrency=${cfg.r2Concurrency} health=${healthOn ? 'on' : 'off'} end=${safety.isoMinute(deadlines.end)} model_concurrency=${cfg.modelConcurrency}`);
  const { createClient } = require('@supabase/supabase-js');
  const key = e.SUPABASE_SERVICE_ROLE_KEY || e.SUPABASE_SERVICE_KEY;
  const clientFor = (url, inflight) => createClient(url, key, { auth: { persistSession: false },
    global: { fetch: safety.guardedFetch({ fetch: netFetch, maxInFlight: inflight, timeoutMs: cfg.timeoutMs }) } });
  const raw = clientFor(e.SUPABASE_URL, cfg.dbInflight);
  // The source tables (sessions, users, schools, transcripts) are read from here; coachip_ tables stay on the primary.
  const readRaw = read.source === 'replica' ? clientFor(read.url, cfg.readInflight) : raw;
  // now is a Date (runJob stamps computed_at with it); modelConcurrency reaches runPhonics through the model context's deps.
  const guard = { health, deadlines, now: () => (sys.now ? sys.now() : new Date()), modelConcurrency: cfg.modelConcurrency };
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
      mode: 'read_only', envName: asserted.env, ref: asserted.ref, readClient: env.readOnlyClient(readRaw), store: new store.MemoryStore(), ...guard,
      // A dry run mints throwaway keys: nothing it writes can be joined to a stored code.
      secret: crypto.randomBytes(32).toString('hex'), out, log, apiKey: e.OPENROUTER_API_KEY,
    });
    // The purge's dry run reads the coachip_ tables (when each session was last shown) through a store that refuses writes.
    return thenPurge(code, require('../lib/insights/purge').readOnlyStore(new store.SupabaseStore(readRaw)));
  }
  if (!purgeOnly(opts) && !e.COACHIP_TEACHER_KEY_SECRET) { log('missing COACHIP_TEACHER_KEY_SECRET'); return 3; }
  const { Client } = require('pg');
  const pg = new Client(pgConfig(e));
  await pg.connect();
  try {
    return await withRunLock(pg, log, async () => {
      const clipBucket = e.COACHIP_CLIP_BUCKET || e.R2_BUCKET_NAME;
      let clipper = null;
      if (e.R2_ENDPOINT && clipBucket) {
        const { createClipper, r2FromEnv } = require('../lib/insights/clip-stage');
        clipper = createClipper({ envName: asserted.env, bucket: clipBucket, ...r2FromEnv(e), concurrency: cfg.r2Concurrency,
          shouldStop: async () => {
            if (health) { const h = await health.check(); if (!h.ok) throw new safety.HealthAbort('clips', h.reason); }
            return guard.now().getTime() >= deadlines.clips;
          } });
      }
      const code = purgeOnly(opts) ? 0 : await runJob(opts, {
        mode: 'write', envName: asserted.env, ref: asserted.ref, readClient: readRaw, store: new store.SupabaseStore(raw), ...guard,
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

module.exports = { main, parseArgs, defaultDate, withRunLock, purgeOnly, safetyConfig, pgConfig, STAGES };
