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
 * @returns {string}
 */
function resolveApiBaseUrl({ isNative = false, isProd = false, apiBaseUrl } = {}) {
  const configured = typeof apiBaseUrl === 'string' ? apiBaseUrl.trim() : '';
  const isAbsolute = /^https?:\/\//i.test(configured);

  if (isNative) {
    if (!isAbsolute) {
      throw new Error(
        'Native builds need an absolute API base URL. Set VITE_API_BASE_URL to the ' +
          "portal's full origin (e.g. https://portal.example.com/api/portal) — a " +
          'relative path resolves to the WebView host, where no server is listening.'
      );
    }
    return stripTrailingSlash(configured);
  }

  // An explicit absolute override is honoured on the web too (useful for
  // pointing a local build at staging).
  if (isAbsolute) return stripTrailingSlash(configured);

  return isProd ? '/api/portal' : 'http://localhost:4000/api/portal';
}

/**
 * Where should the native shell load its web assets from? (bd-2553)
 *
 * The Android app is a pure WebView wrap with no native plugins, so the web
 * bundle is the entire product. Loading it from the live portal turns every
 * web deploy into an instant update for all users, and reserves Play releases
 * for genuinely native changes. Without this, a one-line CSS fix needs a
 * signed upload and a Play review — which is how bd-2551's white screen stayed
 * live long enough to need a downtime notice to 80 coaches.
 *
 * The origin is DERIVED from the API URL rather than configured separately, so
 * the host serving the code can never drift from the host serving the data.
 *
 * Returns `null` to mean "use the assets bundled in the APK". Every failure
 * path returns null rather than throwing: this runs at native boot, and a
 * throw here is precisely the white screen we are eliminating. The bundled
 * build is a known-good floor — shipping "the version in the APK" always beats
 * shipping nothing.
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
    // `origin` drops the path, query and fragment — the app loads the SITE,
    // not the API endpoint — while preserving an explicit non-default port.
    return url.origin;
  } catch {
    // Unparseable or relative — fall back to the bundled assets.
    return null;
  }
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

module.exports = { resolveIsPortal, resolveApiBaseUrl, resolveOtaUrl };
