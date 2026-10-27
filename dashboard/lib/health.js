'use strict';
/**
 * GET /health (moved here from index.js so it can be tested) plus `db_writable` (bd-sex15q.19; SPEC v2.1 §11.5).
 *
 * On 26 Oct 2026 one session-level `SET default_transaction_read_only = on` sent through the transaction-mode pooler
 * (port 6543) stuck to a backend and made sandbox read-only for 23 minutes while /health stayed 200. Supabase also
 * turns a database read-only on its own when the disk fills. The deploy proof now reads `db_writable == true`.
 *
 * The check never sends a session SET: it reads the setting, then opens a transaction, reads whether that transaction
 * is read-only, sends `SET LOCAL` (which dies with the transaction) and rolls back. Any error or a timeout is `false`.
 * The rest of the body is byte-for-byte what it was, and the status stays 200 (the healthcheck is about the process).
 */
const fs = require('fs');

const DEFAULT_TIMEOUT_MS = 2000;

async function probe(pool) {
  const client = await pool.connect();
  try {
    const def = await client.query("SELECT current_setting('default_transaction_read_only') AS v");
    await client.query('BEGIN');
    try {
      const tx = await client.query("SELECT current_setting('transaction_read_only') AS v");
      await client.query('SET LOCAL default_transaction_read_only = on');
      return def.rows[0].v === 'off' && tx.rows[0].v === 'off';
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    client.release();
  }
}

/** true only when a new transaction on this pool can write; never throws. */
async function dbWritable(pool, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!pool || typeof pool.connect !== 'function') return false;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  try {
    return await Promise.race([probe(pool).catch(() => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function healthHandler({ pool, versionFile, timeoutMs } = {}) {
  return async (req, res) => {
    let version = '2.1.0'; // Default fallback
    try {
      if (fs.existsSync(versionFile)) {
        version = fs.readFileSync(versionFile, 'utf8').trim();
      }
    } catch (err) {
      console.error('Error reading VERSION file:', err);
    }

    const writable = await dbWritable(pool, { timeoutMs });
    res.json({
      status: 'healthy',
      service: 'Rumi Dashboard',
      version: version,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      db_writable: writable,
    });
  };
}

module.exports = { healthHandler, dbWritable };
