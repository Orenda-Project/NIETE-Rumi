/**
 * bd-fxk3t8 — the portal's first paint (server side).
 *
 * Measured on sandbox (2026-10-09), a returning teacher waited 4–12 s, most of it on a
 * white screen or a full-screen spinner. Three causes live on the server and in the
 * build, and this file pins each one:
 *
 *  1. GET /config read eight flags one after another (1.8–4.9 s on sandbox). Every v2
 *     page waits on it. The reads are independent, so they run together.
 *  2. Every file was served `max-age=0`, so a returning visit re-asked for the 3 MB
 *     bundle before it could paint. Vite names everything in /assets/ after a hash of
 *     its content: those can be kept for a year. index.html names the current hashes,
 *     so it is revalidated on every visit — a deploy still reaches everyone.
 *  3. The sandbox/staging services build with NODE_ENV=staging, so Vite shipped React's
 *     development build (3.4 MB instead of 2.0 MB). The portal build forces production.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/* ── 1. /config reads its flags together ─────────────────────────────────── */

function findRoute(router, method, p) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === p && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method} ${p}`);
}

describe('GET /config — the flag reads run together', () => {
  let pending;

  beforeEach(() => {
    jest.resetModules();
    pending = [];
    // Each app_settings read waits until the test lets it go, so the test can count how
    // many were started before the first one finished.
    const chain = () => {
      const c = {
        select: () => c, eq: () => c, order: () => c, limit: () => c,
        maybeSingle: () => new Promise((resolve) => pending.push(() => resolve({ data: { value: true }, error: null }))),
      };
      c.single = c.maybeSingle;
      return c;
    };
    jest.doMock('../../dashboard/config/supabase', () => ({ from: () => chain(), rpc: jest.fn() }));
    jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
    }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  });
  afterEach(() => jest.resetModules());

  test('every flag read has started before the first one answers, and the answer is unchanged', async () => {
    const routes = require('../../dashboard/routes/portal.routes');
    const [handler] = findRoute(routes, 'get', '/config').slice(-1);
    let payload = null;
    const res = { status() { return this; }, json(b) { payload = b; return this; } };
    const done = handler({ session: { portalUserId: 'teacher-1' }, query: {}, params: {}, headers: {}, get: () => undefined }, res, () => {});

    // let the handler run up to its first await
    for (let i = 0; i < 5; i += 1) await Promise.resolve(); // eslint-disable-line no-await-in-loop
    const started = pending.length;
    // release everything (including any read that only starts after an earlier one)
    while (payload === null) {
      while (pending.length) pending.shift()();
      await new Promise((r) => setImmediate(r)); // eslint-disable-line no-await-in-loop
    }
    await done;

    expect(started).toBe(8);
    expect(payload.features).toMatchObject({
      assessmentGenerator: true,
      assessmentEditing: true,
      selfObservation: true,
      childTest: true,
      coachObservation: true,
      newUi: true,
      coachV2: true,
      teacherV2: true,
      assessmentGeneratorMessage: null,
    });
  });
});

/* ── 2. how long a browser may keep each file ───────────────────────────── */

describe('portal static files — cache headers', () => {
  const cache = () => require('../../dashboard/lib/portal-static-cache');
  const headersFor = (file) => {
    const h = {};
    cache().portalStaticHeaders({ setHeader: (k, v) => { h[k] = v; } }, file);
    return h['Cache-Control'];
  };
  const DIST = path.join('/app', 'dashboard', 'portal-frontend', 'dist');

  test.each([
    'assets/index-B_dpDXm6.js',
    'assets/index-Cg2yqQmP.css',
    'assets/logo-a1B2c3D4.png',
    'assets/PortalTraining-x_Y-z123.js',
  ])('a hashed build file (%s) is kept for a year', (f) => {
    expect(headersFor(path.join(DIST, f))).toBe('public, max-age=31536000, immutable');
  });

  test('index.html is revalidated on every visit', () => {
    expect(headersFor(path.join(DIST, 'index.html'))).toBe('no-cache');
    expect(cache().PORTAL_INDEX_CACHE_CONTROL).toBe('no-cache');
  });

  test.each(['favicon.png', 'robots.txt', 'assets/readme.txt'])('a file without a content hash (%s) keeps the default', (f) => {
    expect(headersFor(path.join(DIST, f))).toBeUndefined();
  });

  test('the server uses them: static files and the SPA fallback', () => {
    const src = fs.readFileSync(path.join(ROOT, 'dashboard', 'index.js'), 'utf8');
    expect(src).toMatch(/express\.static\(path\.join\(__dirname, 'portal-frontend', 'dist'\), \{ setHeaders: portalStaticHeaders \}\)/);
    const fallback = src.slice(src.indexOf("app.get('*'"), src.indexOf("app.get('*'") + 1200);
    expect(fallback).toMatch(/res\.setHeader\('Cache-Control', PORTAL_INDEX_CACHE_CONTROL\);\s*res\.sendFile\(path\.join\(__dirname, 'portal-frontend', 'dist', 'index\.html'\)\)/);
  });
});

/* ── 3. the portal is built for production on every service ─────────────── */

describe('portal build', () => {
  test('the build script forces a production build whatever NODE_ENV the service sets', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'portal', 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toBe('NODE_ENV=production vite build');
    // the install step must NOT run under NODE_ENV=production: npm would skip vite itself
    const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(root.scripts['build:portal']).toMatch(/^npm ci --prefix portal && npm run build --prefix portal/);
  });
});
