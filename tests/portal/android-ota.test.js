/**
 * bd-2553 — remote-first OTA for the Android app.
 *
 * WHY THIS EXISTS. Today a one-line portal fix reaches app users only through
 * a full Play release: build, sign, upload, internal track, promote, review,
 * staged rollout. Days. bd-2551 (versionCode 1206 white-screening on every
 * launch) is exactly the class of bug where "days" is the wrong number, and
 * bd-2552 is the WhatsApp downtime notice that went to 80 coaches because of it.
 *
 * WHY IT IS SAFE HERE, specifically. This app is a pure WebView wrap with zero
 * native plugins — package.json carries only @capacitor/android, /core and
 * /cli. There is no native surface for the JS and the native shell to
 * disagree about, which is the usual hazard of OTA. So pointing the WebView at
 * the live portal makes a web deploy an instant update for every user, and the
 * native shell only needs a Play release when something genuinely native
 * changes (Capacitor upgrade, manifest, MainActivity, SDK bump).
 *
 * THE FAILURE MODE THIS GUARDS. A remote-first app has one new way to brick
 * itself: point the WebView at the wrong host, or at a host that stops
 * serving, and every user gets a blank shell with no way back — worse than
 * bd-2551, because a Play rollback can't fix a URL baked into a build users
 * already have. So the rules below are contract, not preference:
 *
 *   1. The OTA origin is DERIVED from the same VITE_API_BASE_URL the app
 *      already trusts for its data. One source of truth; the server the app
 *      loads code from cannot drift from the server it loads data from.
 *   2. It must be absolute and https — a WebView served over http would be
 *      mixed content, and a relative path means "localhost", which is the
 *      bd-2551 bug wearing a different hat.
 *   3. Web builds NEVER get a remote URL. The website already is the server;
 *      giving it one would make the site load itself in a loop.
 *   4. A missing/garbage config falls back to the BUNDLED assets rather than
 *      throwing. The bundle shipped inside the APK is a known-good floor —
 *      degrading to "the version we shipped" always beats a white screen.
 */

const {
  resolveOtaUrl,
  resolveApiBaseUrl,
} = require('../../portal/src/lib/app-target.cjs');

const API = 'https://portal-x.up.railway.app/api/portal';

describe('resolveOtaUrl — where the native shell loads its web assets', () => {
  describe('native builds load from the live portal', () => {
    it('derives the web origin from the configured API URL', () => {
      // The API path is stripped: the app loads the SITE, not the endpoint.
      expect(resolveOtaUrl({ isNative: true, apiBaseUrl: API })).toBe(
        'https://portal-x.up.railway.app/portal/login'
      );
    });

    it('keeps a host that serves the API at its root', () => {
      expect(
        resolveOtaUrl({ isNative: true, apiBaseUrl: 'https://portal.niete.pk/api/portal' })
      ).toBe('https://portal.niete.pk/portal/login');
    });

    it('ignores query strings and fragments', () => {
      expect(
        resolveOtaUrl({ isNative: true, apiBaseUrl: 'https://portal.niete.pk/api/portal?v=2' })
      ).toBe('https://portal.niete.pk/portal/login');
    });

    it('preserves an explicit non-default port', () => {
      expect(
        resolveOtaUrl({ isNative: true, apiBaseUrl: 'https://staging.niete.pk:8443/api/portal' })
      ).toBe('https://staging.niete.pk:8443/portal/login');
    });
  });

  // bd-2562: the first OTA APK on real hardware landed on a grey screen and
  // deep-linked into Chrome. The resolver returned the bare ORIGIN, and the
  // portal root 302-redirects to the public marketing site
  // (https://niete.edu.pk). The WebView followed it, decided it was an
  // external site, and handed off to the browser — leaving the app blank.
  //
  // Only the portal PATHS are the app: `/` is a redirect, `/portal/login` and
  // `/portal/dashboard` both return 200 with no redirect. So the OTA target
  // must be a portal path, never the origin.
  describe('never lands on the redirecting root (bd-2562)', () => {
    it('targets a /portal path, not the bare origin', () => {
      const url = resolveOtaUrl({ isNative: true, apiBaseUrl: API });
      expect(new URL(url).pathname).toMatch(/^\/portal\//);
    });

    it('is not the origin alone', () => {
      const url = resolveOtaUrl({ isNative: true, apiBaseUrl: API });
      expect(url).not.toBe(new URL(url).origin);
    });
  });

  describe('falls back to the bundled assets rather than bricking', () => {
    // null === "use the assets inside the APK". Never throw here: this runs
    // at native boot, and a throw is the white screen we are eliminating.
    it('returns null when no API URL is configured', () => {
      expect(resolveOtaUrl({ isNative: true })).toBeNull();
    });

    it('returns null for a relative API path', () => {
      expect(resolveOtaUrl({ isNative: true, apiBaseUrl: '/api/portal' })).toBeNull();
    });

    it('returns null for an unparseable URL', () => {
      expect(resolveOtaUrl({ isNative: true, apiBaseUrl: 'not a url' })).toBeNull();
    });

    it('refuses plain http (a WebView over http is mixed content)', () => {
      expect(
        resolveOtaUrl({ isNative: true, apiBaseUrl: 'http://portal.niete.pk/api/portal' })
      ).toBeNull();
    });

    it('never throws, whatever it is handed', () => {
      const junk = [undefined, null, '', '   ', 'ftp://x/y', '://', 42, {}];
      for (const apiBaseUrl of junk) {
        expect(() => resolveOtaUrl({ isNative: true, apiBaseUrl })).not.toThrow();
      }
    });
  });

  describe('web builds are never remote-loaded', () => {
    it('returns null on the web even with an absolute API URL', () => {
      expect(resolveOtaUrl({ isNative: false, apiBaseUrl: API })).toBeNull();
    });

    it('defaults to non-native when isNative is omitted', () => {
      expect(resolveOtaUrl({ apiBaseUrl: API })).toBeNull();
    });
  });

  describe('the OTA origin and the API origin cannot drift apart', () => {
    // Rule 1, asserted directly: both derive from one configured value, so
    // the app can never load code from one host and data from another.
    it('agrees with resolveApiBaseUrl on the host', () => {
      for (const url of [
        'https://portal-x.up.railway.app/api/portal',
        'https://portal.niete.pk/api/portal',
        'https://staging.niete.pk:8443/api/portal',
      ]) {
        const ota = resolveOtaUrl({ isNative: true, apiBaseUrl: url });
        const api = resolveApiBaseUrl({ isNative: true, apiBaseUrl: url });
        // Same host: the app cannot load code from one server and data from another.
        expect(new URL(ota).origin).toBe(new URL(api).origin);
      }
    });
  });
});
