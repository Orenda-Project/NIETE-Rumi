/**
 * Android App Links — turning an incoming link into an in-app route.
 *
 * When Android opens the NIETE app from a tapped link, Capacitor still boots the
 * WebView at its start page; the link only reaches the web code as an
 * `appUrlOpen` event. These pure functions decide what that link means:
 *
 *   - resolvePortalOrigin: which origin counts as "our portal". Bundled builds
 *     carry an absolute API url; OTA builds are served BY the portal and use a
 *     relative one, so the page's own origin is the answer there.
 *   - resolveAppLinkPath: the router path to open, or null to ignore the link.
 *
 * The manifest decides WHICH links Android hands the app; this code accepts any
 * /portal/ page on our own origin, so widening the manifest later needs no web
 * change. Anything else — another host, plain http, a custom scheme, a non-portal
 * path — is ignored rather than navigated to.
 */

const { resolvePortalOrigin, resolveAppLinkPath } = require('../../portal/src/lib/app-links.cjs');

const ORIGIN = 'https://portal.example.org';

describe('resolvePortalOrigin', () => {
  it('uses the absolute API base url of a bundled build', () => {
    expect(
      resolvePortalOrigin({ apiBaseUrl: 'https://portal.example.org/api/portal', pageHref: 'https://localhost/' })
    ).toBe(ORIGIN);
  });

  it('uses the page origin when the API url is relative (OTA: served by the portal itself)', () => {
    expect(
      resolvePortalOrigin({ apiBaseUrl: '/api/portal', pageHref: 'https://portal.example.org/portal/dashboard' })
    ).toBe(ORIGIN);
  });

  it.each([
    ['nothing', {}],
    ['an http origin', { apiBaseUrl: 'http://portal.example.org/api/portal', pageHref: 'http://portal.example.org/' }],
    ['garbage', { apiBaseUrl: '::::', pageHref: 'not a url' }],
  ])('returns null for %s', (_label, input) => {
    expect(resolvePortalOrigin(input)).toBeNull();
  });
});

describe('resolveAppLinkPath', () => {
  it.each([
    ['https://portal.example.org/portal/dashboard', '/portal/dashboard'],
    ['https://portal.example.org/portal/login', '/portal/login'],
    ['https://PORTAL.example.org/portal/login', '/portal/login'],
    ['https://portal.example.org/portal/dashboard?src=whatsapp', '/portal/dashboard?src=whatsapp'],
    ['https://portal.example.org/portal/dashboard#top', '/portal/dashboard#top'],
    ['https://portal.example.org/portal/coaching/session/42', '/portal/coaching/session/42'],
  ])('opens %s at %s', (url, expected) => {
    expect(resolveAppLinkPath(url, { portalOrigin: ORIGIN })).toBe(expected);
  });

  it.each([
    ['another host', 'https://evil.example.com/portal/dashboard'],
    ['a look-alike host', 'https://portal.example.org.evil.com/portal/dashboard'],
    ['another port', 'https://portal.example.org:8443/portal/dashboard'],
    ['plain http', 'http://portal.example.org/portal/dashboard'],
    ['a custom scheme', 'niete://portal/dashboard'],
    ['a non-portal path', 'https://portal.example.org/api/portal/certificates/1'],
    ['the site root', 'https://portal.example.org/'],
    ['a prefix look-alike', 'https://portal.example.org/portalx/dashboard'],
    ['a traversal out of /portal/', 'https://portal.example.org/portal/../api/portal/me'],
    ['an empty string', ''],
    ['not a url', 'dashboard'],
  ])('ignores %s', (_label, url) => {
    expect(resolveAppLinkPath(url, { portalOrigin: ORIGIN })).toBeNull();
  });

  it('ignores everything when the portal origin is unknown', () => {
    expect(resolveAppLinkPath('https://portal.example.org/portal/dashboard', { portalOrigin: null })).toBeNull();
    expect(resolveAppLinkPath('https://portal.example.org/portal/dashboard', {})).toBeNull();
  });

  it('ignores non-string input without throwing', () => {
    expect(resolveAppLinkPath(undefined, { portalOrigin: ORIGIN })).toBeNull();
    expect(resolveAppLinkPath({ url: 'x' }, { portalOrigin: ORIGIN })).toBeNull();
  });
});

describe('App.tsx wiring', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../portal/src/App.tsx'), 'utf8');

  it('mounts the app-link listener inside the router (it needs navigate)', () => {
    const open = app.indexOf('<BrowserRouter>');
    const listener = app.indexOf('<AppLinkListener />');
    const close = app.indexOf('</BrowserRouter>');
    expect(listener).toBeGreaterThan(open);
    expect(listener).toBeLessThan(close);
    expect(open).toBeGreaterThan(-1);
  });
});
