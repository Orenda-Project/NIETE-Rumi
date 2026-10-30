/**
 * Database Context Middleware - FIXED VERSION
 *
 * Fixes applied:
 * - Uses res.on('finish') for reliable cleanup (works with ALL response types)
 * - No method overriding (res.send/json) - avoids race conditions
 * - Single release point with 'released' flag (no double release)
 * - Handles res.render(), res.redirect(), and all response methods
 * - Request timeout protection (30s default)
 * - Slow request logging (>5s)
 *
 * Flow:
 * 1. Get user ID from session (req.session.userId)
 * 2. Get database client from pool
 * 3. For a signed-in admin, req.dbClient runs every statement in its own transaction under
 *    SET LOCAL ROLE portal_app_user + set_config('app.portal_user_id', userId, true)
 * 4. Release the client after the response via res.on('finish')
 *
 * bd-sex15q.50: prod's portal is on the 6543 TRANSACTION pooler, where consecutive statements of one client can run on
 * different backends and a backend serves whoever comes next. The old session-scope SET ROLE + set_portal_user_context
 * stayed on whichever backend took them: another request's statements (a coach's, COACHIP's own pool.query) could run
 * as portal_app_user with this admin's id, and this admin's next statement could run on a backend with neither.
 * Transaction-local settings end with their transaction, so nothing is left on a pooled backend.
 *
 * Bead: - Fix portal database connection pool leak
 */

const pool = require('../../config/database');
const { getTimeoutForRoute } = require('../timeout');

const REQUEST_TIMEOUT_MS = 30000; // 30 seconds

// bd-5gyspy.9: a route the app gives a longer budget (middleware/timeout.js, e.g. the coaching-session routes' 120 s
// for the bot's LLM) keeps it here too; this layer answered 504 at 30 s while the app still allowed 90 s more.
// the request's path without its query string: what the log lines name (bd-pk8vtb: a ?k= child chip or a token in the
// query string must never reach the logs) and what the budget is looked up by
const pathOf = (req) => String(req.path || req.url || '').split('?')[0];
const budgetFor = (req) => Math.max(REQUEST_TIMEOUT_MS, getTimeoutForRoute(pathOf(req)));
// what the log lines print (redteam MED-1, 04 #152 r2's shape): a path segment of 20+ token characters is a bearer token
// (an invitation's 64-hex token, a hub token; a uuid too) and prints as '…'; short ids like /q/RJWABM stay. The budget
// above keeps the unmasked path.
const logPath = (req) => pathOf(req).split('/').map((seg) => (/^[A-Za-z0-9._~%-]{20,}$/.test(seg) ? '…' : seg)).join('/');

const sqlOf = (args) => String((typeof args[0] === 'string' ? args[0] : args[0] && args[0].text) || '').trim().toUpperCase();
const OPENS = /^(BEGIN|START\s+TRANSACTION)\b/;
const CLOSES = /^(COMMIT|END|ROLLBACK|ABORT)\b(?!\s+TO\b)/;

/**
 * bd-sex15q.50: the query surface req.dbClient gets for a signed-in admin. Each statement runs as
 *   BEGIN; SET LOCAL ROLE portal_app_user; set_config('app.portal_user_id', userId, true); <statement>; COMMIT
 * so it keeps today's autocommit semantics (a failed statement does not poison the next) and holds a pooled backend only
 * while it runs. A handler's own BEGIN … COMMIT gets the role and id once, at its BEGIN. Statements are queued, so a
 * Promise.all on req.dbClient cannot interleave one statement's BEGIN with another's COMMIT.
 */
function scopedClient(client, userId) {
  let queue = Promise.resolve();
  let pending = 0;
  let ownTransaction = false;
  const scope = async () => {
    await client.query('SET LOCAL ROLE portal_app_user');
    await client.query("SELECT set_config('app.portal_user_id', $1::uuid::text, true)", [userId]);
  };
  const run = async (args) => {
    const sql = sqlOf(args);
    if (ownTransaction) {
      if (CLOSES.test(sql)) ownTransaction = false;
      return client.query(...args);
    }
    if (OPENS.test(sql)) {
      const opened = await client.query(...args);
      try { await scope(); } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; }
      ownTransaction = true;
      return opened;
    }
    await client.query('BEGIN');
    try {
      await scope();
      const result = await client.query(...args);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  };
  return {
    query(...args) {
      pending += 1;
      const done = queue.then(() => run(args)).finally(() => { pending -= 1; });
      queue = done.catch(() => {});
      return done;
    },
    // true while a statement is in flight or a handler's transaction is open: the client must not go back to the pool
    get busy() { return pending > 0 || ownTransaction; },
  };
}

/**
 * Database Context Middleware
 * Applies portal_app_user role and sets user context for RLS
 */
async function setDatabaseContext(req, res, next) {
  // bd-sex15q.49: a hashed static chunk needs no RLS. Checking a client out for it held a pooler slot for the whole
  // transfer, so one phone on a slow network opening This week (~30 chunks) filled the session pooler and the chunks 500'd.
  if ((req.method === 'GET' || req.method === 'HEAD') && pathOf(req).startsWith('/assets/')) return next();
  let client;
  let scoped = null;
  let released = false;
  const startTime = Date.now();

  // Cleanup function - only releases once (protected by 'released' flag)
  const cleanup = async (source) => {
    if (released) return;
    released = true;

    const duration = Date.now() - startTime;

    try {
      if (client) {
        // bd-sex15q.50: nothing session-scoped is ever set, so there is nothing to reset. A client torn down with a scoped
        // statement in flight or a handler's transaction open is destroyed, never handed to the next request mid-transaction.
        client.release(Boolean(scoped && scoped.busy));
        client = null;
        req.dbClient = null;
      }
    } catch (err) {
      console.error(`[DB Context] Cleanup error (${source}):`, err.message);
    }

    // Log slow requests for debugging
    if (duration > 5000) {
      console.warn(`[DB Context] Slow request: ${req.method} ${logPath(req)} took ${duration}ms`);
    }
  };

  // Request timeout protection - prevents connections being held indefinitely
  const timeoutId = setTimeout(() => {
    console.error(`[DB Context] Request timeout: ${req.method} ${logPath(req)}`);
    cleanup('timeout');
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timeout' });
    }
  }, budgetFor(req));

  try {
    // Get a database client from the pool
    client = await pool.connect();

    const isAuthenticated = req.session && req.session.userId;

    // Apply RLS context for authenticated users, one transaction per statement (bd-sex15q.50)
    scoped = isAuthenticated ? scopedClient(client, req.session.userId) : null;
    req.dbClient = scoped || client;

    // FIXED: Single cleanup point using 'finish' event
    // This fires for ALL response types: send, json, render, redirect, etc.
    res.on('finish', () => {
      clearTimeout(timeoutId);
      cleanup('finish');
    });

    // Also handle aborted/closed connections (client disconnected early)
    res.on('close', () => {
      if (!res.writableEnded) {
        console.warn(`[DB Context] Connection closed early: ${req.method} ${logPath(req)}`);
        clearTimeout(timeoutId);
        cleanup('close');
      }
    });

    next();
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('[DB Context] Setup error:', error.message);

    // Cleanup on error
    await cleanup('error');
    next(error);
  }
}

/**
 * Helper function to execute queries with database context
 * Simplified - no cleanup responsibility (middleware handles it)
 */
async function withDatabaseContext(req, queryFn) {
  if (!req.dbClient) {
    throw new Error('Database context not set. Ensure setDatabaseContext middleware is applied.');
  }
  // Just run the query, let middleware handle cleanup
  return await queryFn(req.dbClient);
}

module.exports = {
  setDatabaseContext,
  withDatabaseContext
};
