/**
 * Where am I running, and where is the API?
 *
 * The portal SPA serves two audiences from one build: the public marketing
 * site and the authenticated teacher/coach portal. On the web it tells them
 * apart by hostname. Inside a Capacitor Android app that breaks — the WebView
 * serves the bundle from https://localhost, so hostname sniffing says
 * "marketing site" and a relative API path resolves to a host with no server.
 *
 * These two functions are the single place those decisions are made. Kept as
 * CommonJS with no imports so the same file is testable under the repo's Jest
 * runner and consumable by Vite.
 */

/**
 * Should we render the portal (rather than the public marketing site)?
 *
 * @param {object}  opts
 * @param {boolean} [opts.isNative]  running inside a Capacitor native shell
 * @param {string}  [opts.appTarget] explicit build-time target: 'app' | 'web'
 * @param {string}  [opts.hostname]  window.location.hostname (web fallback)
 * @returns {boolean}
 */
function resolveIsPortal({ isNative = false, appTarget, hostname = '' } = {}) {
  // In a native shell there is no marketing site — the app IS the portal.
  if (isNative) return true;
  if (appTarget === 'app') return true;

  // Web: a `portal.` subdomain serves the portal. Anchored so hosts that
  // merely contain "portal." (e.g. myportal.example.com) don't match.
  return hostname.startsWith('portal.');
}

/**
 * Base URL for the portal JSON API.
 *
 * Web keeps the existing same-origin relative path (no CORS, no third-party
 * cookies). Native has no origin of its own, so an absolute URL is required —
 * we fail loudly rather than silently requesting a host that isn't there.
 *
 * @param {object}  opts
 * @param {boolean} [opts.isNative]
 * @param {boolean} [opts.isProd]
 * @param {string}  [opts.apiBaseUrl] configured absolute URL (VITE_API_BASE_URL)
 * @param {string}  [opts.origin] window.location.origin — where the page came from
 * @returns {string}
 */
function resolveApiBaseUrl({ isNative = false, isProd = false, apiBaseUrl, origin } = {}) {
  const configured = typeof apiBaseUrl === 'string' ? apiBaseUrl.trim() : '';
  const isAbsolute = /^https?:\/\//i.test(configured);

  if (isNative) {
    if (isAbsolute) return stripTrailingSlash(configured);

    // bd-2554/bd-2566: under remote-first OTA the WebView runs the WEB bundle,
    // served by the portal itself — so there is no VITE_API_BASE_URL, but there
    // IS a real origin, and a relative path resolves against the very server
    // that sent the page. Requiring an absolute URL here throws at first render
    // and white-screens the app on every launch. That shipped as versionCode
    // 1208: the app loaded https://portal.niete.edu.pk/portal/login correctly,
    // then died on this line before React could mount.
    //
    // The rule was never "native => absolute"; it is "no usable origin =>
    // absolute". A bundled app sits on https://localhost (or
    // capacitor://localhost) where nothing is listening — that case must stay
    // loud. Being SERVED by a real https host is the evidence that it is safe.
    if (isServedByRealHost(origin)) return isProd ? '/api/portal' : stripTrailingSlash(origin) + '/api/portal';

    throw new Error(
      'Native builds need an absolute API base URL. Set VITE_API_BASE_URL to the ' +
        "portal's full origin (e.g. https://portal.example.com/api/portal) — a " +
        'relative path resolves to the WebView host, where no server is listening.'
    );
  }

  // An explicit absolute override is honoured on the web too (useful for
  // pointing a local build at staging).
  if (isAbsolute) return stripTrailingSlash(configured);

  if (isProd) return '/api/portal';

  // bd-2559: `isProd` is Vite's import.meta.env.PROD, baked in at BUILD time
  // from NODE_ENV. The staging service sets NODE_ENV=staging — not the literal
  // "production" — so every staging build shipped with isProd false and this
  // fallback hardcoded a localhost URL into the bundle. The browser then fired
  // its login preflight at http://localhost:4000, a host that does not exist
  // for the user, and login failed. Production escaped only because its
  // service happens to say NODE_ENV=production; that is luck, not design.
  //
  // The fallback exists for `vite dev`, where the SPA is served from
  // localhost:5173 while the API runs separately on :4000. So the real signal
  // is WHERE THE PAGE CAME FROM, not what NODE_ENV said at build time: a page
  // served by a real remote host is served by something that also serves the
  // API, and same-origin is correct. Only a genuinely local origin should
  // reach for the dev server.
  if (isServedByRealHost(origin)) return '/api/portal';

  return 'http://localhost:4000/api/portal';
}

/**
 * The path an OTA build loads. Not `/` — the portal root 302-redirects to the
 * public marketing site, which sent the WebView to Chrome and left the app
 * grey (bd-2562). `/portal/login` is the app's entry point and returns 200
 * with no redirect; the SPA router forwards an authenticated user onward.
 */
const OTA_ENTRY_PATH = '/portal/login';

/**
 * Where should the native shell load its web assets from? (bd-2553)
 *
 * The Android app is a pure WebView wrap with no native plugins, so the web
 * bundle is the entire product. Loading it from the live portal turns every
 * web deploy into an instant update for all users, and reserves Play releases
 * for genuinely native changes (Capacitor, manifest, MainActivity, SDK).
 *
 * The origin is DERIVED from the API URL rather than configured separately, so
 * the host serving the code can never drift from the host serving the data.
 *
 * Returns `null` to mean "use the assets bundled in the APK". Every failure
 * path returns null rather than throwing: this runs at native boot, and a
 * throw here is a white screen with no way back — a bad server.url is compiled
 * into the APK and cannot be fixed by a web deploy, only another Play release.
 * The bundled build is a known-good floor.
 *
 * @param {object}  opts
 * @param {boolean} [opts.isNative]  running inside a Capacitor native shell
 * @param {string}  [opts.apiBaseUrl] configured absolute URL (VITE_API_BASE_URL)
 * @returns {string|null} origin to load from, or null for the bundled assets
 */
function resolveOtaUrl({ isNative = false, apiBaseUrl } = {}) {
  // The web build IS the server. Pointing it at itself would loop.
  if (!isNative) return null;
  if (typeof apiBaseUrl !== 'string') return null;

  try {
    const url = new URL(apiBaseUrl.trim());
    // https only: a WebView loading over http is mixed content, and any other
    // scheme (file:, ftp:) is not something we should ever boot from.
    if (url.protocol !== 'https:') return null;
    // bd-2562: return a PORTAL PATH, not the bare origin.
    //
    // The origin alone looked right and was wrong on real hardware: the portal
    // root 302-redirects to the public marketing site (niete.edu.pk), so the
    // WebView followed the redirect, judged it an external site, and handed
    // off to Chrome — leaving the app on a grey screen. `/portal/login`
    // returns 200 with no redirect and is the app's real entry point; the SPA
    // router sends an already-authenticated user on to the dashboard.
    //
    // `origin` is still what strips the API path, query and fragment while
    // preserving an explicit non-default port.
    return `${url.origin}${OTA_ENTRY_PATH}`;
  } catch {
    // Unparseable or relative — fall back to the bundled assets.
    return null;
  }
}

/**
 * Was this page served by a real remote host? (bd-2559)
 *
 * The signal for "this is a developer running `vite dev`" is the page's own
 * origin — localhost:5173, with the API on a separate port — not what NODE_ENV
 * happened to say when the bundle was built. A page served by a real https host
 * is served by something that also serves the API, so a relative path is right.
 *
 * Deliberately conservative: anything unrecognised returns false, which falls
 * back to the dev URL. That is the safe direction here — a developer sees an
 * obviously wrong localhost call immediately, whereas a deployed build that
 * guessed "real host" wrongly would be silently broken for users.
 */
function isServedByRealHost(origin) {
  if (typeof origin !== 'string') return false;
  try {
    const { protocol, hostname } = new URL(origin);
    // https only: a portal served over plain http is not a host we should
    // trust for the API, and file:// is not a server at all.
    if (protocol !== 'https:') return false;
    // Local origins are the dev case, which is what the fallback is for.
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return false;
    return true;
  } catch {
    return false;
  }
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

module.exports = { resolveIsPortal, resolveApiBaseUrl, resolveOtaUrl };
