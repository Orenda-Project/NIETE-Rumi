/**
 * Android App Links — what does an incoming link mean?
 *
 * When Android opens the app from a tapped link, Capacitor still boots the
 * WebView at its start page; the link reaches the web code only as an
 * `appUrlOpen` event from @capacitor/app. These two functions decide what to do
 * with it.
 *
 * Which links reach the app at all is decided by the intent filter in
 * AndroidManifest.xml (a Play release to change). This side accepts any
 * /portal/ page on our own origin, so widening the manifest later needs no web
 * change — and it ignores everything else rather than navigating to it.
 *
 * Kept as CommonJS with no imports so the same file is testable under the
 * repo's Jest runner and consumable by Vite (same as app-target.cjs).
 */

/**
 * The origin that counts as "our portal".
 *
 * A bundled build carries an absolute API url; an OTA build is served BY the
 * portal and uses a relative one, which resolves against the page itself.
 *
 * @param {object} opts
 * @param {string} [opts.apiBaseUrl]  the resolved portal API base url
 * @param {string} [opts.pageHref]    window.location.href
 * @returns {string|null}  e.g. "https://portal.example.org", or null if unknown
 */
function resolvePortalOrigin({ apiBaseUrl, pageHref } = {}) {
  if (typeof apiBaseUrl !== 'string' || !apiBaseUrl.trim()) return null;
  try {
    const url = new URL(apiBaseUrl.trim(), pageHref);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The router path an incoming link should open, or null to ignore it.
 *
 * @param {string} url                 the link Android handed the app
 * @param {object} opts
 * @param {string|null} [opts.portalOrigin]  from resolvePortalOrigin
 * @returns {string|null}  pathname + search + hash, e.g. "/portal/dashboard"
 */
function resolveAppLinkPath(url, { portalOrigin } = {}) {
  if (typeof url !== 'string' || !url || typeof portalOrigin !== 'string' || !portalOrigin) {
    return null;
  }
  let link;
  let portal;
  try {
    link = new URL(url);
    portal = new URL(portalOrigin);
  } catch {
    return null;
  }
  if (link.protocol !== 'https:') return null;
  // origin compares scheme + host + port; URL lower-cases the host.
  if (link.origin !== portal.origin) return null;
  // pathname is already normalised, so "/portal/../api" arrives as "/api".
  if (!link.pathname.startsWith('/portal/')) return null;
  return link.pathname + link.search + link.hash;
}

module.exports = { resolvePortalOrigin, resolveAppLinkPath };
