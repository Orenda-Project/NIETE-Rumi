#!/usr/bin/env node
'use strict';
/**
 * bd-2kxxa.5 — ONE-OFF: re-transcribe the Section-B-blank observations from
 * their R2 audio and recompute lesson-plan fidelity.
 *
 *   # measure one session, write nothing
 *   node scripts/backfill-section-b-retranscribe.js --ids <uuid> --dry-run
 *
 *   # the cohort, dry
 *   node scripts/backfill-section-b-retranscribe.js --since 2026-08-28 --until 2026-09-04 --dry-run --out results.jsonl
 *
 *   # for real (needs the confirm env)
 *   BACKFILL_CONFIRM=SECTION_B node scripts/backfill-section-b-retranscribe.js --since 2026-08-28 --until 2026-09-04 --concurrency 2 --out results.jsonl
 *
 * Selection (when --ids is not given): coaching_sessions with observer_user_id
 * NOT NULL, created_at in [--since, --until), analysis_data->lp_fidelity->>status
 * = 'ok', ->>fidelity_pct IS NULL, audio_url NOT NULL, status in BACKFILL_STATUSES.
 * Paginated by keyset on (created_at, id) — never OFFSET — 200 ids per page,
 * projecting only id + created_at (database-engineering §1: no fat columns in
 * a set scan; the fat read happens once per row, by id, in the service).
 *
 * What this does NOT do: send any message, re-render or re-send any report,
 * change status, touch rows whose pct is already filled, or run without
 * BACKFILL_CONFIRM=SECTION_B unless --dry-run.
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (shared/config/supabase),
 * R2_ENDPOINT + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_BUCKET_NAME
 * (shared/storage/r2), SONIOX_API_KEY (+ OPENAI_API_KEY for the Whisper
 * fallback) (shared/config/env → audio.service), and whatever the fidelity
 * grader's LLM client reads (fidelity-analyzer / lp-fidelity-store).
 */

const fs = require('fs');
const path = require('path');

const PAGE_SIZE = 200;
/** NIETE prod project ref — a worktree seeded with the MAIN bot's .env points at a different prod DB. */
const EXPECTED_PROJECT_REF = 'ihzciabopbttygxxgrkm';

function parseArgs(argv) {
  const a = {
    since: null, until: null, ids: null, limit: null, concurrency: 2,
    dryRun: false, out: null, allowAnyProject: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--since': a.since = v; i++; break;
      case '--until': a.until = v; i++; break;
      case '--ids': a.ids = String(v).split(',').map((s) => s.trim()).filter(Boolean); i++; break;
      case '--limit': a.limit = parseInt(v, 10); i++; break;
      case '--concurrency': a.concurrency = Math.max(1, parseInt(v, 10) || 1); i++; break;
      case '--out': a.out = v; i++; break;
      case '--dry-run': a.dryRun = true; break;
      case '--allow-any-project': a.allowAnyProject = true; break;
      case '--help': case '-h': a.help = true; break;
      default:
        throw new Error(`unknown flag: ${k}`);
    }
  }
  return a;
}

/** Returns an error string when the run may not proceed, else null. */
function confirmGate(args, env) {
  if (args.dryRun) return null;
  if (env.BACKFILL_CONFIRM === 'SECTION_B') return null;
  return 'Refusing to write: set BACKFILL_CONFIRM=SECTION_B to run without --dry-run.';
}

function projectGate(args, env) {
  if (args.allowAnyProject) return null;
  const url = env.SUPABASE_URL || '';
  if (!url.includes(EXPECTED_PROJECT_REF)) {
    return `SUPABASE_URL does not point at the NIETE project (${EXPECTED_PROJECT_REF}); got "${url}". ` +
      'A worktree seeded from the main bot .env hits a DIFFERENT prod DB. Fix .env or pass --allow-any-project.';
  }
  return null;
}

/**
 * Keyset-paginated id selection. `queryFactory()` must return a fresh
 * supabase query builder on coaching_sessions each call (injected for tests).
 */
async function selectCandidateIds({ since, until, limit, statuses, queryFactory, log = () => {} }) {
  const ids = [];
  let cursor = null;
  for (;;) {
    let q = queryFactory()
      .select('id, created_at')
      .not('observer_user_id', 'is', null)
      .not('audio_url', 'is', null)
      .in('status', statuses)
      .eq('analysis_data->lp_fidelity->>status', 'ok')
      .is('analysis_data->lp_fidelity->>fidelity_pct', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (since) q = q.gte('created_at', since);
    if (until) q = q.lt('created_at', until);
    if (cursor) {
      q = q.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`);
    }
    const { data, error } = await q;
    if (error) throw new Error(`selection failed: ${error.message}`);
    const rows = data || [];
    for (const r of rows) {
      ids.push(r.id);
      if (limit && ids.length >= limit) return ids;
    }
    log(`page: ${rows.length} rows (total ${ids.length})`);
    if (rows.length < PAGE_SIZE) return ids;
    cursor = rows[rows.length - 1];
  }
}

function emptySummary() {
  return { scanned: 0, repaired: 0, still_untimestamped: 0, failed: 0, skipped_not_null: 0, by_reason: {} };
}

function tally(summary, res) {
  summary.scanned++;
  if (res.ok) { summary.repaired++; return; }
  const reason = res.reason || 'unknown';
  summary.by_reason[reason] = (summary.by_reason[reason] || 0) + 1;
  if (reason === 'still_untimestamped') summary.still_untimestamped++;
  else if (reason === 'skipped_not_null') summary.skipped_not_null++;
  else summary.failed++;
}

async function runPool(items, concurrency, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0] + '*/\n');
    return 0;
  }
  if (!args.ids && !(args.since && args.until)) {
    throw new Error('need --ids a,b,c OR both --since YYYY-MM-DD and --until YYYY-MM-DD');
  }
  const gate = confirmGate(args, env);
  if (gate) { console.error(gate); return 2; }
  const proj = projectGate(args, env);
  if (proj) { console.error(proj); return 2; }

  const { backfillSession, BACKFILL_STATUSES } = require('../shared/services/coaching/fidelity/section-b-backfill.service');
  const supabase = require('../shared/config/supabase');

  const ids = args.ids || await selectCandidateIds({
    since: args.since, until: args.until, limit: args.limit, statuses: BACKFILL_STATUSES,
    queryFactory: () => supabase.from('coaching_sessions'),
    log: (m) => console.log(`[select] ${m}`),
  });
  const work = args.limit ? ids.slice(0, args.limit) : ids;
  console.log(`[sectionb-backfill] ${work.length} session(s) selected · dryRun=${args.dryRun} · concurrency=${args.concurrency}`);

  const summary = emptySummary();
  const out = args.out ? fs.createWriteStream(path.resolve(args.out), { flags: 'a' }) : null;

  await runPool(work, args.concurrency, async (sessionId, i) => {
    const t0 = Date.now();
    const res = await backfillSession(sessionId, { dryRun: args.dryRun, log: (msg, ctx) => console.log(msg, JSON.stringify(ctx || {})) });
    const line = { ...res, ms: Date.now() - t0, at: new Date().toISOString() };
    tally(summary, res);
    console.log(`[${i + 1}/${work.length}] ${sessionId} → ${res.ok ? (args.dryRun ? 'WOULD REPAIR' : 'repaired') : res.reason}` +
      (res.after && res.after.pct != null ? ` pct=${res.after.pct}` : '') + ` (${line.ms}ms)`);
    if (out) out.write(JSON.stringify(line) + '\n');
  });

  if (out) await new Promise((r) => out.end(r));
  console.log('[sectionb-backfill] summary', JSON.stringify(summary));
  return 0;
}

module.exports = { parseArgs, confirmGate, projectGate, selectCandidateIds, tally, emptySummary, runPool, main, PAGE_SIZE, EXPECTED_PROJECT_REF };

if (require.main === module) {
  require('dotenv').config();
  main().then((code) => process.exit(code)).catch((e) => { console.error(e.message || e); process.exit(1); });
}
