#!/usr/bin/env node
'use strict';
/**
 * One A/B tracker rollup tick, for the tracker's own Railway project (bd-3kshar.6.5). Railway's cron starts this
 * every 15 minutes (railway.ab-tracker-cron.json); the rollup runs once per slot — 15 minutes in school hours, 2 hours
 * outside them (shared/services/ab-tracker/ab-tracker-cadence.js) — and keeps every guard (replica only, the
 * ab_tracker_rollup_enabled switch, one caller per tick). Then it closes Redis and exits.
 * Exit 1 on a refused, partial or failed run so the Railway run shows red; exit 0 on every quiet outcome.
 * After a rollup that ran it advances the A/B ledger once (planned -> running -> concluded; bd-9nb6s0.2).
 * Before exiting it sends the buffered log lines to Axiom: process.exit() skips the logger's beforeExit flush, so
 * until bd-3kshar.20 no cron line ever reached niete-logs and a failed run could not be alerted on.
 */
const { logToFile } = require('../shared/utils/logger');

const QUIET = new Set(['ran', 'off', 'not_due', 'skipped', 'done_already']);

function exitCodeFor(result) {
  // No Redis means the tick claim can never succeed, so the job would skip every run in silence: show it red.
  if (result && result.outcome === 'skipped' && result.reason === 'unavailable') return 1;
  return result && QUIET.has(result.outcome) ? 0 : 1;
}

/** Send what the Axiom batcher holds and wait for the ingest request, capped so a hung Axiom never holds the cron. */
async function flushLogs({
  batcher = require('../shared/utils/structured-logger').axiomBatcher,
  timeoutMs = 5000,
  stepMs = 50,
} = {}) {
  if (!batcher) return;
  batcher.flush();
  const end = Date.now() + timeoutMs;
  while (batcher.isFlushing && Date.now() < end) await new Promise((r) => setTimeout(r, stepMs));
}

async function main({
  run = (...a) => require('../shared/services/ab-tracker/ab-tracker-rollup.service').run(...a),
  ledger = (...a) => require('../shared/services/ab-tracker/ab-ledger.service').advance(...a),
  switcher = (...a) => require('../shared/services/ab-tracker/ab-ledger.service').flip(...a),
  redis = require('../shared/services/cache/railway-redis.service'),
  flush = flushLogs,
  exit = (code) => process.exit(code),
} = {}) {
  let result;
  try {
    result = await run();
  } catch (error) {
    logToFile('❌ A/B tracker cron: the run threw', { error: error && error.message }, 'error');
  }
  // The ledger (bd-9nb6s0.2): only after a rollup that ran, so every rollup guard held. Never changes the exit code.
  // Then the switch (bd-9nb6s0.6): a test the ledger just concluded hands its winner to everyone, or records a pending flip.
  let ledgerOutcome;
  let switchOutcome;
  if (result && result.outcome === 'ran') {
    try {
      ledgerOutcome = (await ledger()).outcome;
    } catch (error) {
      ledgerOutcome = 'failed';
      logToFile('A/B tracker cron: the ledger step threw (ignored)', { error: error && error.message }, 'warn');
    }
    try {
      switchOutcome = (await switcher()).outcome;
    } catch (error) {
      switchOutcome = 'failed';
      logToFile('A/B tracker cron: the switch step threw (ignored)', { error: error && error.message }, 'warn');
    }
  }
  logToFile('A/B tracker cron: done', { outcome: result && result.outcome, ledger: ledgerOutcome, switch: switchOutcome });
  try {
    await redis.close();
  } catch (error) {
    logToFile('A/B tracker cron: Redis close failed (ignored)', { error: error && error.message }, 'warn');
  }
  try {
    await flush();
  } catch (_) {
    // Logging must never change the run's exit code.
  }
  exit(exitCodeFor(result));
}

if (require.main === module) main();

module.exports = { main, exitCodeFor, flushLogs };
