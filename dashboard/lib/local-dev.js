/**
 * What changes when the portal API runs on a laptop against the local database (bd-hnhlgn.1).
 * `scripts/dev-portal.sh up` starts it that way. Everything here is a no-op in production:
 *  - dbSsl drops SSL only for a loopback DB host (a local Postgres does not speak SSL);
 *  - sessionCookie relaxes Secure/SameSite=None only when PORTAL_LOCAL_DEV=1 AND SUPABASE_URL is a
 *    loopback URL, because over http://localhost the browser drops a Secure cookie and every request
 *    after /login comes back "Not authenticated". One stray variable alone changes nothing.
 */
function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

function dbSsl(host) {
  return isLoopbackHost(host) ? false : { rejectUnauthorized: false };
}

function isLocalDev(env) {
  if (env.PORTAL_LOCAL_DEV !== '1') return false;
  try {
    return isLoopbackHost(new URL(env.SUPABASE_URL).hostname);
  } catch (_) {
    return false;
  }
}

function sessionCookie(env) {
  const local = isLocalDev(env);
  return {
    secure: !local, // HTTPS only, except a local dev run on http://localhost
    httpOnly: true, // Prevents client-side JS from accessing cookie
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    // 'none' so the Capacitor app can hold a session (see index.js); browsers refuse 'none' without Secure
    sameSite: local ? 'lax' : (env.SESSION_COOKIE_SAMESITE || 'none'),
  };
}

module.exports = { isLoopbackHost, dbSsl, isLocalDev, sessionCookie };
