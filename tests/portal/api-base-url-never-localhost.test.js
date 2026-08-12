/**
 * bd-2559 — a page served from a real host must never call localhost.
 *
 * THE BUG, seen live on staging. `resolveApiBaseUrl` fell back to
 * `http://localhost:4000/api/portal` whenever `isProd` was false. `isProd`
 * comes from Vite's `import.meta.env.PROD`, which Vite derives from NODE_ENV
 * at BUILD time — and the staging portal service sets `NODE_ENV=staging`.
 *
 * Not "production", so PROD was false, so every deployed staging build baked
 * in a localhost URL. The browser then fired its login preflight at
 * http://localhost:4000 — a host that does not exist for the user — and the
 * OPTIONS call failed. Reproduced exactly: NODE_ENV=staging emits `isProd:!1`
 * and ships the localhost string; NODE_ENV=production emits `isProd:!0`.
 *
 * Production was unaffected only because its service happens to set
 * NODE_ENV=production. That is luck, not design: the dev fallback was one
 * env-var typo away from shipping to teachers, on any deploy, silently.
 *
 * THE FIX. The localhost fallback exists for `vite dev`, where the page is
 * served from localhost:5173 and the API runs separately on :4000. The signal
 * for "am I a developer" is therefore WHERE THE PAGE CAME FROM, not what
 * NODE_ENV said at build time. If the page was served by a real remote host,
 * same-origin `/api/portal` is correct — that host is serving the API too.
 *
 * NODE_ENV stays as a hint for the genuine dev case, but it can no longer
 * cause a deployed build to call a machine that isn't there.
 */

const { resolveApiBaseUrl } = require('../../portal/src/lib/app-target.cjs');

const STAGING = 'https://portal-staging.example.com';
const PROD = 'https://portal.example.com';

describe('bd-2559 — a real host never resolves to localhost', () => {
  // The exact staging configuration: built with NODE_ENV=staging so isProd is
  // false, served over https from a real hostname.
  it('uses the same-origin path when isProd is false but the host is real', () => {
    expect(resolveApiBaseUrl({ isProd: false, origin: STAGING })).toBe('/api/portal');
  });

  it('does the same for production hosts', () => {
    expect(resolveApiBaseUrl({ isProd: true, origin: PROD })).toBe('/api/portal');
  });

  it('never returns a localhost URL to a page served from a real host', () => {
    for (const isProd of [true, false]) {
      for (const origin of [STAGING, PROD, 'https://niete.edu.pk']) {
        expect(resolveApiBaseUrl({ isProd, origin })).not.toMatch(/localhost/);
      }
    }
  });

  it('an explicit absolute URL still wins', () => {
    expect(
      resolveApiBaseUrl({ isProd: false, origin: STAGING, apiBaseUrl: `${PROD}/api/portal` })
    ).toBe(`${PROD}/api/portal`);
  });
});

describe('bd-2559 — local development is unchanged', () => {
  // The fallback's real purpose: `vite dev` serves the SPA on :5173 while the
  // API runs separately on :4000, so same-origin would be wrong there.
  it('still points at the local API server when served from the dev server', () => {
    expect(resolveApiBaseUrl({ isProd: false, origin: 'http://localhost:5173' })).toBe(
      'http://localhost:4000/api/portal'
    );
  });

  it('handles 127.0.0.1 the same way', () => {
    expect(resolveApiBaseUrl({ isProd: false, origin: 'http://127.0.0.1:5173' })).toBe(
      'http://localhost:4000/api/portal'
    );
  });

  it('falls back to the dev API when there is no origin at all (SSR/tests)', () => {
    // No window: nothing to infer from, so honour the build-time hint.
    expect(resolveApiBaseUrl({ isProd: false })).toBe('http://localhost:4000/api/portal');
  });

  it('a prod build with no origin still uses the relative path', () => {
    expect(resolveApiBaseUrl({ isProd: true })).toBe('/api/portal');
  });
});
