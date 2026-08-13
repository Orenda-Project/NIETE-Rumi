/**
 * bd-2676 — the WebView must keep portal navigations in-app.
 *
 * THE BUG, observed on a handset (RMX2061, Android 10, debug v1209):
 * tapping a certificate ejected the app to Chrome and the portal answered
 *   {"success":false,"error":"Not authenticated. Please log in.",
 *    "debug":{"hasSession":true,"hasPortalUserId":false,
 *             "hasCookieHeader":false,"cookieHeaderLength":0}}
 *
 * A bundled app runs on `https://localhost`. The certificate url points at the
 * portal API's own origin, so it is a CROSS-ORIGIN navigation, and Capacitor
 * hands those to the system browser by default. Chrome carries none of the
 * WebView's cookies → no session → 401. `hasSession:true` with
 * `hasPortalUserId:false` is the server minting a FRESH empty session for the
 * cookieless request, not the teacher's one.
 *
 * IT IS NOT A `target="_blank"` PROBLEM. That was the first diagnosis and it was
 * wrong: the hand-off happens with no target attribute at all. Removing _blank
 * was necessary (Chrome also 401s) but never sufficient.
 *
 * The allowlist is DERIVED from VITE_API_BASE_URL rather than hardcoded, so a
 * staging build allows staging and a production build allows production, and
 * neither can drift from the host the app actually calls.
 *
 * ⚠️ capacitor.config.ts is a NATIVE-SHELL file — it compiles into the APK.
 * This fix reaches users only through a Play release, NOT via OTA or a Railway
 * deploy. See the niete-release skill §2.
 */

const path = require('path');

const CONFIG = path.resolve(__dirname, '../../portal/capacitor.config.ts');

/**
 * Load capacitor.config.ts with a given env.
 *
 * It is TypeScript, but type-annotation-free at runtime except for the
 * `import type` (erased) and two `: string[]`/`: string | null` annotations, so
 * it cannot be require()d directly. Read it and evaluate the two pure pieces we
 * care about instead of booting the Capacitor CLI.
 */
function loadAllowNavigation(env) {
  const fs = require('fs');
  const src = fs.readFileSync(CONFIG, 'utf8');

  // Pull out the helper and re-evaluate it against a supplied env. Keeps the
  // test honest about the REAL source rather than a copy of the logic.
  const fnMatch = src.match(/function allowedNavigationHosts\(\)[\s\S]*?\n\}/);
  if (!fnMatch) throw new Error('allowedNavigationHosts() not found in capacitor.config.ts');

  // Strip the TS return annotation (`): string[] {` → `) {`) — new Function
  // parses plain JS, and the annotation is the only TS syntax in the helper.
  const js = fnMatch[0].replace(/\)\s*:\s*string\[\]\s*\{/, ') {');

  // eslint-disable-next-line no-new-func
  const factory = new Function('process', `${js}; return allowedNavigationHosts();`);
  return factory({ env });
}

describe('bd-2676 — allowNavigation is derived from the configured API host', () => {
  it('allows the staging portal host for a staging build', () => {
    const hosts = loadAllowNavigation({
      VITE_API_BASE_URL: 'https://portal-staging.example.app/api/portal',
    });
    expect(hosts).toEqual(['portal-staging.example.app']);
  });

  it('allows the production portal host for a production build', () => {
    const hosts = loadAllowNavigation({
      VITE_API_BASE_URL: 'https://portal.example.edu/api/portal',
    });
    expect(hosts).toEqual(['portal.example.edu']);
  });

  it('is a HOSTNAME, never a full url with a path', () => {
    // Capacitor matches hostnames; passing a url silently matches nothing, which
    // would look configured and still hand off to Chrome.
    const [host] = loadAllowNavigation({
      VITE_API_BASE_URL: 'https://portal.example.edu/api/portal',
    });
    expect(host).not.toMatch(/^https?:/);
    expect(host).not.toContain('/');
  });

  it('returns [] when VITE_API_BASE_URL is absent (a web build)', () => {
    expect(loadAllowNavigation({})).toEqual([]);
  });

  it('refuses a non-https host — a WebView on http is mixed content', () => {
    expect(loadAllowNavigation({ VITE_API_BASE_URL: 'http://insecure.example/api' })).toEqual([]);
  });

  it('returns [] rather than throwing on an unparseable value', () => {
    // This runs at native build time; a throw fails the build for a value that
    // is legitimately absent or malformed in a web build.
    expect(loadAllowNavigation({ VITE_API_BASE_URL: 'not-a-url' })).toEqual([]);
    expect(loadAllowNavigation({ VITE_API_BASE_URL: '   ' })).toEqual([]);
  });
});

describe('bd-2676 — the shipped config carries no diagnostic leftovers', () => {
  const fs = require('fs');
  const src = () => fs.readFileSync(CONFIG, 'utf8');

  it('does not hardcode any deployment host', () => {
    // The diagnostic build hardcoded two hosts to test the hypothesis. A
    // hardcoded host in a public repo is also a source-hygiene violation.
    expect(src()).not.toMatch(/allowNavigation:\s*\[\s*['"]/);
  });

  it('keeps loggingBehavior at production', () => {
    // 'debug' was enabled to capture navigation urls. Unbounded bridge output
    // caused a real memory incident on the existing app.
    expect(src()).toMatch(/loggingBehavior:\s*'production'/);
  });
});
