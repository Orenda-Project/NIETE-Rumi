/**
 * Materialized View Refresh Scheduler
 *
 * Automatically refreshes dashboard materialized views every 15 minutes
 * (MV_REFRESH_INTERVAL_MS). Uses REFRESH MATERIALIZED VIEW CONCURRENTLY to allow
 * reads during refresh.
 *
 * Runs once per deployment, not once per process:
 * - cluster.js marks exactly one worker MV_SCHEDULER_OWNER=1 and the rest 0;
 *   a worker marked 0 never starts the loop. An unclustered process has no mark
 *   and starts it.
 * - Each run takes pg_try_advisory_xact_lock on the same key as the SQL function
 *   refresh_dashboard_views(), so a second replica (or that function) skips
 *   instead of queueing. The lock is transaction-scoped because DATABASE_URL goes
 *   through the transaction pooler, where a session lock can stay held on a
 *   pooled backend. Each view refreshes inside a savepoint so one failure does
 *   not abort the rest.
 * - A tick that fires while the previous run is still going is skipped.
 * - MV_SCHEDULER_ENABLED=false turns the scheduler off entirely.
 *
 * Strategies considered:
 * 1. Application scheduler (this file) - Simple, no external dependencies
 * 2. pg_cron extension - Better for production, requires Supabase config
 * 3. External cron (Railway, GitHub Actions) - More complex setup
 *
 * Current implementation: Application scheduler with setInterval
 * Recommended for production: pg_cron for reliability
 *
 * @module mv-refresh-scheduler.service
 * @bead
 */

const { Pool } = require('pg');
const materializedViews = require('./materialized-views.service');

// Configuration
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const INITIAL_DELAY_MS = 30 * 1000; // 30 seconds after startup
const LOCK_SQL = "SELECT pg_try_advisory_xact_lock(hashtext('refresh_dashboard_views')::bigint) AS locked";

let isRunning = false;
let refreshInFlight = false;
let activeIntervalMs = REFRESH_INTERVAL_MS;
let initialTimer = null;
let refreshInterval = null;
let pool = null;

/**
 * Initialize the refresh scheduler
 * Called once on application startup
 *
 * @param {Object} options - Scheduler options
 * @param {string} options.connectionString - PostgreSQL connection string
 * @param {number} options.intervalMs - Refresh interval in milliseconds
 */
function start(options = {}) {
  if (isRunning) {
    console.log('[MV Scheduler] Already running, skipping start');
    return;
  }

  if (process.env.MV_SCHEDULER_ENABLED === 'false') {
    console.log('[MV Scheduler] Disabled by MV_SCHEDULER_ENABLED=false, not starting');
    return;
  }

  if (process.env.MV_SCHEDULER_OWNER === '0') {
    console.log(`[MV Scheduler] Another cluster worker owns the scheduler, not starting in pid ${process.pid}`);
    return;
  }

  const connectionString = options.connectionString || process.env.DATABASE_URL;
  const intervalMs = options.intervalMs || parseInt(process.env.MV_REFRESH_INTERVAL_MS || '0', 10) || REFRESH_INTERVAL_MS;

  if (!connectionString) {
    console.error('[MV Scheduler] No DATABASE_URL configured, skipping scheduler');
    return;
  }

  // Create dedicated pool for refresh operations
  pool = new Pool({
    connectionString,
    max: 2, // Only need 1-2 connections for refresh
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    application_name: 'mv_refresh_scheduler'
  });

  pool.on('error', (err) => {
    console.error('[MV Scheduler] Pool error:', err.message);
  });

  isRunning = true;
  activeIntervalMs = intervalMs;
  console.log(`[MV Scheduler] Starting with ${intervalMs / 1000}s interval`);

  // Initial delay before first refresh
  initialTimer = setTimeout(async () => {
    initialTimer = null;
    await refreshWithPool();
    if (!isRunning) return;

    // Then schedule regular refreshes
    refreshInterval = setInterval(async () => {
      await refreshWithPool();
    }, intervalMs);
  }, INITIAL_DELAY_MS);

  console.log(`[MV Scheduler] First refresh in ${INITIAL_DELAY_MS / 1000}s`);
}

/**
 * Stop the refresh scheduler
 */
function stop() {
  if (!isRunning) {
    return;
  }

  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }

  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }

  if (pool) {
    pool.end().catch(err => {
      console.error('[MV Scheduler] Error closing pool:', err.message);
    });
    pool = null;
  }

  isRunning = false;
  refreshInFlight = false;
  console.log('[MV Scheduler] Stopped');
}

/**
 * Wrap a client so each query runs in its own savepoint: inside the locked
 * transaction a failed REFRESH would otherwise abort every view after it.
 */
function savepointClient(client) {
  return {
    query: async (...args) => {
      await client.query('SAVEPOINT mv_refresh_view');
      try {
        const result = await client.query(...args);
        await client.query('RELEASE SAVEPOINT mv_refresh_view');
        return result;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT mv_refresh_view');
        throw error;
      }
    }
  };
}

/**
 * Perform one locked refresh run using a pool connection.
 * Logs exactly one summary line: run done / run skipped / run failed.
 */
async function refreshWithPool() {
  if (!pool) {
    console.error('[MV Scheduler] Pool not initialized');
    return;
  }

  if (refreshInFlight) {
    console.log('[MV Scheduler] run skipped reason=in_flight');
    return;
  }

  refreshInFlight = true;
  const startTime = Date.now();
  let client;
  let inTransaction = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    inTransaction = true;

    const { rows } = await client.query(LOCK_SQL);
    if (!rows[0] || !rows[0].locked) {
      await client.query('ROLLBACK');
      inTransaction = false;
      console.log(`[MV Scheduler] run skipped reason=lock_held in ${Date.now() - startTime}ms`);
      return;
    }

    const result = await materializedViews.refreshAllViews(savepointClient(client));
    await client.query('COMMIT');
    inTransaction = false;

    console.log(`[MV Scheduler] run done in ${Date.now() - startTime}ms views=${result.views.length} errors=${result.errors.length}`, {
      timings: result.timings
    });

    if (result.errors.length > 0) {
      console.error('[MV Scheduler] Refresh errors:', result.errors);
    }
  } catch (error) {
    console.error(`[MV Scheduler] run failed in ${Date.now() - startTime}ms: ${error.message}`);
    if (client && inTransaction) {
      await client.query('ROLLBACK').catch(() => {});
    }
  } finally {
    refreshInFlight = false;
    if (client) {
      client.release();
    }
  }
}

/**
 * Force an immediate refresh (for manual triggers)
 *
 * @param {Object} dbClient - Database client to use
 */
async function forceRefresh(dbClient) {
  console.log('[MV Scheduler] Force refresh triggered');
  return await materializedViews.refreshAllViews(dbClient);
}

/**
 * Get scheduler status
 *
 * @returns {Object} Current scheduler status
 */
function getStatus() {
  return {
    isRunning,
    intervalMs: activeIntervalMs,
    refreshInFlight,
    poolConnected: pool !== null
  };
}

module.exports = {
  start,
  stop,
  forceRefresh,
  getStatus,
  REFRESH_INTERVAL_MS
};
