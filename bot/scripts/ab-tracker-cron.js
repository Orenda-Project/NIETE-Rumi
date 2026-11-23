#!/usr/bin/env node
'use strict';
/**
 * One A/B tracker rollup tick, for the tracker's own Railway project (bd-3kshar.6.5). Railway's cron starts this
 * every 15 minutes (railway.ab-tracker-cron.json); the rollup runs once per slot — 15 minutes in school hours, 2 hours
 * outside them (shared/services/ab-tracker/ab-tracker-cadence.js) — and keeps every guard (replica only, the
 * ab_tracker_rollup_enabled switch, one caller per tick). Then it closes Redis and exits.
 * Exit 1 on a refused, partial or failed run so the Railway run shows red; exit 0 on every quiet outcome.
 */
const { logToFile } = require('../shared/utils/logger');

const QUIET = new Set(['ran', 'off', 'not_due', 'skipped', 'done_already']);

function exitCodeFor(result) {
  // No Redis means the tick claim can never succeed, so the job would skip every run in silence: show it red.
  if (result && result.outcome === 'skipped' && result.reason === 'unavailable') return 1;
  return result && QUIET.has(result.outcome) ? 0 : 1;
}

async function main({
  run = (...a) => require('../shared/services/ab-tracker/ab-tracker-rollup.service').run(...a),
  redis = require('../shared/services/cache/railway-redis.service'),
  exit = (code) => process.exit(code),
} = {}) {
  let result;
  try {
    result = await run();
  } catch (error) {
    logToFile('❌ A/B tracker cron: the run threw', { error: error && error.message }, 'error');
  }
  logToFile('A/B tracker cron: done', { outcome: result && result.outcome });
  try {
    await redis.close();
  } catch (error) {
    logToFile('A/B tracker cron: Redis close failed (ignored)', { error: error && error.message }, 'warn');
  }
  exit(exitCodeFor(result));
}

if (require.main === module) main();

module.exports = { main, exitCodeFor };
