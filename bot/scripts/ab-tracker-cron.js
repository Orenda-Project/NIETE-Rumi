#!/usr/bin/env node
'use strict';
/**
 * One night's A/B tracker rollup, for the tracker's own Railway project (bd-3kshar.6.5). Railway's cron starts this
 * at 22:00 UTC = 03:00 Pakistan time (railway.ab-tracker-cron.json); it runs the rollup once
 * (shared/services/ab-tracker/ab-tracker-rollup.service.js, which keeps every guard: replica only, the
 * ab_tracker_rollup_enabled switch, one run per Pakistan date), closes Redis and exits.
 * Exit 1 on a refused, partial or failed run so the Railway run shows red; exit 0 on every quiet outcome.
 */
const { logToFile } = require('../shared/utils/logger');

const QUIET = new Set(['ran', 'off', 'not_due', 'skipped', 'done_already']);

function exitCodeFor(result) {
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
