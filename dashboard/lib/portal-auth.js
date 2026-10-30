'use strict';
/**
 * The portal's ONE sign-in check. Every portal router takes `requirePortalAuth` from here; none keeps a copy.
 *
 * A portal session holds a user id (req.session.portalUserId) and rolls 30 days from the last visit. Checking only
 * that the id is there let a session outlive its account. A coach changes a teacher's number onto a second account,
 * which is then retired (users.deleted_at set, the phone renamed `merged:<id>`); a phone already signed in AS that
 * second account kept being served it, empty, and every class and lesson-plan open the teacher made landed on a row
 * that neither the teacher (once signed in again) nor any report reads. So this also asks whether the account is
 * still live:
 *
 *   no user id in the session              → 401
 *   the users row has deleted_at set,      → the session is destroyed, then 401. The app sends the teacher to sign-in,
 *   or there is no row at all                and the WhatsApp code on the number opens a session on the account that
 *                                            holds it now.
 *   the lookup fails (an error or a throw) → FAIL OPEN: the request goes on, and the failure is logged. Deliberate: a
 *                                            database blip must not sign every teacher out at once. A retired account
 *                                            is caught by the next request that can read its row.
 *
 * The answer is held in-process for 30 s per user, as the app_settings flag cache is (lib/feature-flags.js): a
 * retirement takes effect within 30 s, a teacher's burst of requests costs one read, and one read is in flight per
 * user at a time. A failed read is held for 5 s only, so it is asked again soon.
 *
 * Logs only a refusal, on one line; a signed-in request writes nothing (a crowd signing in at once overran the host's
 * log-rate cap when every request logged). A failed lookup logs at most one line every 10 s, with a count.
 */

const ACCOUNT_CACHE_TTL_MS = 30_000;
const ACCOUNT_FAILURE_TTL_MS = 5_000;
const ACCOUNT_CACHE_MAX = 20_000;
const FAILURE_LOG_EVERY_MS = 10_000;

const LIVE = 'live';
const RETIRED = 'retired';
const UNKNOWN = 'unknown';

/** The 401 body every portal router has always sent, byte for byte. */
const NOT_AUTHED = Object.freeze({ success: false, error: 'Not authenticated. Please log in.' });

/** userId → { pending, at, ttl, promise } */
const accounts = new Map();
let lastFailureLogAt = 0;
let failuresSinceLog = 0;

function logLookupFailure(message) {
  failuresSinceLog += 1;
  const now = Date.now();
  if (now - lastFailureLogAt < FAILURE_LOG_EVERY_MS) return;
  console.error(`⚠️ Portal auth: account lookup failed, request let through (fail open): ${JSON.stringify({
    message: String(message || 'unknown').slice(0, 200),
    failures: failuresSinceLog,
  })}`);
  lastFailureLogAt = now;
  failuresSinceLog = 0;
}

/** One uncached read: 'live', 'retired' (deleted_at set, or no row), or 'unknown' (the read failed). Never throws. */
async function readAccount(userId) {
  try {
    // Required here, not at the top: a missing client is a failed read (fail open), never a crash at load.
    const supabase = require('../config/supabase');
    const { data, error } = await supabase
      .from('users').select('id, deleted_at').eq('id', userId).maybeSingle();
    if (error) {
      logLookupFailure(error.message || error.code);
      return UNKNOWN;
    }
    if (!data || data.deleted_at) return RETIRED;
    return LIVE;
  } catch (err) {
    logLookupFailure((err && err.message) || String(err));
    return UNKNOWN;
  }
}

function pruneAccounts(now) {
  for (const [id, e] of accounts) {
    if (!e.pending && now - e.at >= e.ttl) accounts.delete(id);
  }
  if (accounts.size >= ACCOUNT_CACHE_MAX) accounts.clear();
}

/**
 * Is the account behind this user id still live? From the in-process cache when fresh.
 * @param {string} userId
 * @returns {Promise<'live'|'retired'|'unknown'>}
 */
function accountState(userId) {
  const now = Date.now();
  const hit = accounts.get(userId);
  if (hit && (hit.pending || now - hit.at < hit.ttl)) return hit.promise;
  if (accounts.size >= ACCOUNT_CACHE_MAX) pruneAccounts(now);

  const entry = { pending: true, at: 0, ttl: 0, promise: null };
  entry.promise = readAccount(userId).then((state) => {
    entry.pending = false;
    entry.at = Date.now();
    entry.ttl = state === UNKNOWN ? ACCOUNT_FAILURE_TTL_MS : ACCOUNT_CACHE_TTL_MS;
    return state;
  });
  accounts.set(userId, entry);
  return entry.promise;
}

/** Empties the cache. For tests. */
function resetAccountCache() {
  accounts.clear();
  lastFailureLogAt = 0;
  failuresSinceLog = 0;
}

/** What a refusal logs, read before the session is ended. */
function sessionFacts(req) {
  const header = (name) => (typeof req.get === 'function' ? req.get(name) : undefined);
  const cookie = req.headers && req.headers.cookie;
  return {
    hasSession: !!req.session,
    hasPortalUserId: !!(req.session && req.session.portalUserId),
    sessionId: req.session ? req.session.id : null,
    userAgent: header('User-Agent'),
    hasCookieHeader: !!cookie,
    cookieHeaderLength: cookie ? cookie.length : 0,
    origin: header('Origin'),
    referer: header('Referer'),
    method: req.method,
    path: req.path,
    ip: req.ip,
  };
}

function refuse(res, reason, facts) {
  console.log(`❌ Portal Auth Failed: ${JSON.stringify({ reason, ...facts })}`);
  return res.status(401).json({ ...NOT_AUTHED });
}

/** Ends the session (its store row too), then calls done. A store that cannot destroy still gets a 401. */
function endSession(req, done) {
  const session = req.session;
  if (!session || typeof session.destroy !== 'function') {
    if (session) delete session.portalUserId;
    return done();
  }
  try {
    return session.destroy(() => done());
  } catch (_) {
    return done();
  }
}

/**
 * Builds the middleware around an account reader. The portal uses `accountState` below; a route suite that is not
 * about sign-in can build one whose reader says 'live' (tests/fixtures/portal-auth-live.js), so its own fake database
 * needs no users row for its session user.
 * @param {{accountState: (userId: string) => Promise<'live'|'retired'|'unknown'>}} deps
 */
function createRequirePortalAuth({ accountState: readState }) {
  /**
   * Express middleware. 401 without a session user; destroys the session and 401s when the account is retired or
   * gone; otherwise next(). Returns a promise when it looked the account up (Express ignores it; tests await it).
   */
  return function requirePortalAuth(req, res, next) {
    const userId = req.session && req.session.portalUserId;
    if (!userId) {
      return refuse(res, !req.session ? 'No session object' : 'No portalUserId in session', sessionFacts(req));
    }
    const decide = (state) => {
      if (state !== RETIRED) return next();
      const facts = sessionFacts(req);
      return endSession(req, () => refuse(res, 'Account retired: session ended', facts));
    };
    let state;
    try {
      state = readState(userId);
    } catch (_) {
      state = UNKNOWN;
    }
    // A reader that answers at once (a test's) decides at once, exactly as the session-only check did.
    if (!state || typeof state.then !== 'function') return decide(state);
    return state.catch(() => UNKNOWN).then(decide).catch((err) => {
      console.error('❌ Portal auth: middleware failed after the account check:', (err && err.message) || err);
    });
  };
}

const requirePortalAuth = createRequirePortalAuth({ accountState });

module.exports = {
  requirePortalAuth,
  createRequirePortalAuth,
  accountState,
  resetAccountCache,
  NOT_AUTHED,
  ACCOUNT_CACHE_TTL_MS,
  ACCOUNT_FAILURE_TTL_MS,
};
