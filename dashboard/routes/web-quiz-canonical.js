/**
 * One origin for one child. The page remembers who a child is in localStorage,
 * which lives per origin: a link minted on the platform's default domain and one
 * minted on the custom domain made the same child a stranger on one of them (the
 * first-time picker again). So a child-facing page asked for on any other host
 * answers 301 to the same path and query on the canonical host.
 *
 * The canonical host is WEB_QUIZ_BASE_URL, the variable the bot mints child links
 * from (bot/shared/services/quiz/web-quiz-link.js). Unset or not a URL: no redirect.
 *
 * Child pages only: /q/:code (+ /class, /schools), /h/:token, /c/:token, /lib/:token.
 * Never the JSON API, the share pictures, the page assets, the teacher report or health.
 */
const CHILD_PAGE_RX = /^\/(?:q\/[^/]+(?:\/(?:class|schools))?|h\/[^/]+|c\/[^/]+|lib\/[^/]+)\/?$/;
const MAX_AGE_S = 3600; // a 301 is cached by the phone; an hour keeps a wrong setting reversible

function canonicalOrigin(base) {
  try {
    const u = new URL(String(base || '').trim());
    return /^https?:$/.test(u.protocol) && u.hostname ? { origin: u.origin, hostname: u.hostname.toLowerCase() } : null;
  } catch (_) {
    return null;
  }
}

function createCanonicalRedirect(base) {
  const canon = canonicalOrigin(base);
  return function canonicalRedirect(req, res, next) {
    if (!canon || (req.method !== 'GET' && req.method !== 'HEAD') || !CHILD_PAGE_RX.test(req.path)) return next();
    const host = String(req.hostname || '').toLowerCase();
    if (!host || host === canon.hostname) return next();
    res.set('Cache-Control', `public, max-age=${MAX_AGE_S}`);
    return res.redirect(301, `${canon.origin}${req.originalUrl}`);
  };
}

module.exports = { createCanonicalRedirect, canonicalOrigin, CHILD_PAGE_RX };
