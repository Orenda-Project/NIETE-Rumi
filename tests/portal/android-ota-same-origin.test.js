/**
 * bd-2554 — under OTA, a native shell serving the WEB bundle must not throw.
 *
 * THE BUG. bd-2553 added remote-first OTA: the WebView loads the SPA from the
 * live portal instead of the APK. That silently changed which bundle runs
 * inside the native shell. Previously it was always the app-mode bundle, built
 * with `--mode app`, carrying an absolute VITE_API_BASE_URL. Under OTA the
 * WebView fetches whatever the portal serves the WEB — a bundle built with
 * plain `npm run build`, where VITE_API_BASE_URL is undefined.
 *
 * But Capacitor still injects its global into that WebView, so isNativeApp()
 * is STILL true. So resolveApiBaseUrl() took the isNative branch, found no
 * absolute URL, and threw — at first render, before React mounted.
 *
 * That is bd-2551's white screen arriving through a new door: OTA would have
 * bricked every app the moment it was switched on, and worse than 1206,
 * because a Play rollback cannot fix a bundle served from the web.
 *
 * THE FIX. The absolute URL exists because a bundled app has no origin of its
 * own — https://localhost has no server. That reasoning does not hold when the
 * page was SERVED BY the portal: there the page origin IS the API's origin, so
 * a relative '/api/portal' is not merely acceptable, it is the correct answer,
 * and it is what the web build already uses.
 *
 * So the rule is not "native ⇒ absolute URL". It is "no usable origin ⇒
 * absolute URL". These tests pin that distinction.
 */

const { resolveApiBaseUrl } = require('../../portal/src/lib/app-target.cjs');

const PORTAL_HOST = 'portal-production-6a508.up.railway.app';

describe('bd-2554 — OTA: native shell running the web bundle', () => {
  // The exact configuration OTA produces: native shell, web bundle (so no
  // VITE_API_BASE_URL), page served from the portal's own origin.
  const ota = {
    isNative: true,
    isProd: true,
    apiBaseUrl: undefined,
    origin: `https://${PORTAL_HOST}`,
  };

  it('does NOT throw when the page was served by the portal', () => {
    expect(() => resolveApiBaseUrl(ota)).not.toThrow();
  });

  it('uses the same-origin relative path, exactly as the web build does', () => {
    expect(resolveApiBaseUrl(ota)).toBe('/api/portal');
  });

  it('still prefers an explicit absolute URL when the build has one', () => {
    // A bundled app-mode build served from https://localhost keeps working.
    expect(
      resolveApiBaseUrl({ ...ota, apiBaseUrl: `https://${PORTAL_HOST}/api/portal` })
    ).toBe(`https://${PORTAL_HOST}/api/portal`);
  });
});

describe('bd-2554 — the bundled-app guarantee is preserved', () => {
  // The whole point of the original throw: a bundled build has no server at
  // its origin, so a relative path silently resolves to nothing. That failure
  // must STILL be loud — this is the bd-2551 guard and it does not get weakened.
  it('throws for a bundled app at https://localhost with no absolute URL', () => {
    expect(() =>
      resolveApiBaseUrl({ isNative: true, isProd: true, origin: 'https://localhost' })
    ).toThrow(/absolute API base URL/);
  });

  it('throws for the iOS capacitor:// scheme too', () => {
    expect(() =>
      resolveApiBaseUrl({ isNative: true, isProd: true, origin: 'capacitor://localhost' })
    ).toThrow(/absolute API base URL/);
  });

  it('throws when the origin is unknown (no way to tell it is safe)', () => {
    // Absent evidence that we were served by a real server, fail loudly
    // rather than guess — a wrong guess here is a white screen.
    expect(() => resolveApiBaseUrl({ isNative: true, isProd: true })).toThrow(
      /absolute API base URL/
    );
  });

  it('throws for an http origin (never a legitimate portal host)', () => {
    expect(() =>
      resolveApiBaseUrl({ isNative: true, isProd: true, origin: 'http://10.0.2.2:8080' })
    ).toThrow(/absolute API base URL/);
  });
});

describe('bd-2554 — web behaviour is untouched', () => {
  it('prod web still uses the relative path', () => {
    expect(resolveApiBaseUrl({ isProd: true, origin: `https://${PORTAL_HOST}` })).toBe(
      '/api/portal'
    );
  });

  it('dev web still points at the local API server', () => {
    expect(resolveApiBaseUrl({ isProd: false, origin: 'http://localhost:5173' })).toBe(
      'http://localhost:4000/api/portal'
    );
  });
});
