/**
 * bd-2542 — the OTA bundle endpoints, contract-tested.
 *
 * These three routes are how a bundle gets published and how a device asks
 * what it should be running. The failure modes worth guarding are not "does
 * Express respond" — they are:
 *
 *   1. AUTH IS NOT OPTIONAL, AND AN UNSET KEY IS NOT AN OPEN DOOR. The upload
 *      route can deliver executable code to every device in the field, so it is
 *      the most dangerous endpoint in this codebase. If its key env var is
 *      missing, a caller that also sends no key would compare
 *      `undefined === undefined` and be let in. It must refuse instead.
 *
 *   2. THE UPLOAD AND READ KEYS ARE DIFFERENT SECRETS. Devices hold the read
 *      key; only CI holds the upload key. The reference implementation used ONE
 *      key for both — and the same value for staging and production — so
 *      anything that could read could also publish.
 *
 *   3. A BUNDLE CANNOT BE PUBLISHED WITHOUT ITS COMPATIBILITY FLOOR. Missing
 *      min_native_version is a 400, never a default. A default here is a crash
 *      on a device we cannot reach.
 *
 *   4. NOTHING IS SERVED TO A DEVICE THAT DID NOT SAY WHAT IT IS RUNNING. No
 *      native version means no bundle — never a guess.
 *
 * Routes are exercised through the exported router with a fake Supabase and a
 * fake storage client, so this runs in CI with no credentials and no network.
 */

// Route-level table state, reset per test.
let tableRows;
let inserted;

function makeChain(table) {
  const rec = { table, filters: {} };
  const chain = {};
  const rows = () => (tableRows[table] || []).filter((r) =>
    Object.entries(rec.filters).every(([k, v]) => String(r[k]) === String(v)),
  );

  chain.select = jest.fn(() => chain);
  ['eq', 'gte', 'lte', 'lt', 'gt', 'is'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { rec.filters[col] = val; return chain; });
  });
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => Promise.resolve({ data: rows(), error: null }));
  chain.insert = jest.fn((row) => {
    inserted.push({ table, row });
    const chained = {
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'new-id', ...row }, error: null })),
      })),
    };
    return chained;
  });
  // Deliberately NOT thenable. Making the chain itself a promise means `await`
  // resolves it before .order()/.limit() are applied, so the route's real query
  // shape goes untested.
  return chain;
}

const mockSupabase = { from: jest.fn((t) => makeChain(t)) };

jest.mock(
  '../../bot/shared/config/supabase',
  () => mockSupabase,
  { virtual: true },
);

// The storage client is stubbed: this suite is about the HTTP contract, not S3.
const mockStorage = {
  uploadBundle: jest.fn(async () => ({
    bundleUrl: 'https://example.invalid/frontend-bundles/7_niete.zip',
    checksumSha256: 'b'.repeat(64),
  })),
  signBundleUrl: jest.fn(async (url) => `${url}?signed=1`),
};
jest.mock(
  '../../bot/shared/services/bundle-storage.service',
  () => mockStorage,
  { virtual: true },
);

jest.mock(
  '../../bot/shared/utils/logger',
  () => ({ logToFile: jest.fn() }),
  { virtual: true },
);

/** Minimal Express-response double. */
function res() {
  const r = {};
  r.statusCode = 200;
  r.body = undefined;
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((b) => { r.body = b; return r; });
  // 204 replies use .end() with no body — without this the route throws and the
  // catch turns a correct 204 into a 502.
  r.end = jest.fn(() => r);
  return r;
}

/** Invoke a router path directly, running its middleware chain in order. */
async function call(router, method, path, { headers = {}, body = {}, query = {} } = {}) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`no ${method.toUpperCase()} ${path} on router`);

  const req = { headers, body, query, path, ip: '127.0.0.1' };
  const response = res();
  const handlers = layer.route.stack.map((s) => s.handle);

  for (const h of handlers) {
    let advanced = false;
    await h(req, response, () => { advanced = true; });
    if (!advanced) break;   // handler responded — chain stops here
  }
  return response;
}

const UPLOAD_KEY = 'upload-secret';
const READ_KEY = 'read-secret';

describe('bd-2542 — OTA bundle routes', () => {
  let router;

  beforeEach(() => {
    tableRows = { frontend_bundles: [] };
    inserted = [];
    process.env.OTA_UPLOAD_API_KEY = UPLOAD_KEY;
    process.env.OTA_READ_API_KEY = READ_KEY;
    router = require('../../bot/shared/routes/frontend-bundle.routes');
  });

  afterEach(() => {
    delete process.env.OTA_UPLOAD_API_KEY;
    delete process.env.OTA_READ_API_KEY;
  });

  describe('upload auth — the most dangerous endpoint here', () => {
    it('rejects an upload with no key', async () => {
      const r = await call(router, 'post', '/', { body: {} });
      expect(r.statusCode).toBe(401);
    });

    it('rejects an upload bearing the READ key — read must not imply publish', async () => {
      const r = await call(router, 'post', '/', {
        headers: { 'x-api-key': READ_KEY },
        body: {},
      });
      expect(r.statusCode).toBe(401);
      expect(inserted).toHaveLength(0);
    });

    it('REFUSES when the upload key is unset, rather than letting everyone in', async () => {
      // undefined === undefined would otherwise authenticate a caller that
      // sends no key at all.
      //
      // The guard reads process.env at REQUEST time, not module-load time, so
      // deleting the var is enough — no resetModules(), which would re-require
      // the route against a fresh registry while the jest.mock factories stay
      // bound to the original one (the route would then get the real Supabase
      // and throw a 502 instead of the 401 under test).
      delete process.env.OTA_UPLOAD_API_KEY;

      const r = await call(router, 'post', '/', { body: {} });
      expect(r.statusCode).toBe(401);
    });
  });

  describe('upload validation', () => {
    const good = {
      bundleVersion: 7,
      minNativeVersion: 1206,
      environment: 'niete',
      fileBase64: Buffer.from('zip-bytes').toString('base64'),
    };

    it('refuses a bundle with no minNativeVersion', async () => {
      const { minNativeVersion, ...withoutFloor } = good;
      const r = await call(router, 'post', '/', {
        headers: { 'x-api-key': UPLOAD_KEY },
        body: withoutFloor,
      });
      expect(r.statusCode).toBe(400);
      expect(inserted).toHaveLength(0);
    });

    it('publishes to the internal channel by default, at 0% rollout', async () => {
      // A fresh upload must reach nobody until deliberately promoted.
      const r = await call(router, 'post', '/', {
        headers: { 'x-api-key': UPLOAD_KEY },
        body: good,
      });
      expect(r.statusCode).toBe(201);
      expect(inserted).toHaveLength(1);
      expect(inserted[0].row.channel).toBe('internal');
      expect(inserted[0].row.rollout_percent).toBe(0);
    });

    it('records the checksum the storage layer computed', async () => {
      await call(router, 'post', '/', {
        headers: { 'x-api-key': UPLOAD_KEY },
        body: good,
      });
      expect(inserted[0].row.checksum_sha256).toBe('b'.repeat(64));
    });

    it('rejects a non-numeric bundleVersion instead of coercing it', async () => {
      const r = await call(router, 'post', '/', {
        headers: { 'x-api-key': UPLOAD_KEY },
        body: { ...good, bundleVersion: 'latest' },
      });
      expect(r.statusCode).toBe(400);
    });
  });

  describe('device read path', () => {
    beforeEach(() => {
      tableRows.frontend_bundles = [
        {
          id: 'b8', bundle_version: 8, min_native_version: 1206,
          channel: 'production', environment: 'niete', rollout_percent: 100,
          bundle_url: 'https://example.invalid/8.zip',
          checksum_sha256: 'c'.repeat(64),
        },
        {
          id: 'b9', bundle_version: 9, min_native_version: 1207,
          channel: 'production', environment: 'niete', rollout_percent: 100,
          bundle_url: 'https://example.invalid/9.zip',
          checksum_sha256: 'd'.repeat(64),
        },
      ];
    });

    it('requires the read key', async () => {
      const r = await call(router, 'get', '/', {
        query: { environment: 'niete', native: '1206', deviceId: 'd1' },
      });
      expect(r.statusCode).toBe(401);
    });

    it('serves the newest bundle the device can actually run, not the newest overall', async () => {
      const r = await call(router, 'get', '/', {
        headers: { 'x-api-key': READ_KEY },
        query: { environment: 'niete', native: '1206', deviceId: 'd1' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.body.bundle.bundleVersion).toBe(8);
    });

    it('returns 204 and no bundle when the device sent no native version', async () => {
      const r = await call(router, 'get', '/', {
        headers: { 'x-api-key': READ_KEY },
        query: { environment: 'niete', deviceId: 'd1' },
      });
      expect(r.statusCode).toBe(204);
    });

    it('signs the bundle URL rather than exposing the raw storage path', async () => {
      const r = await call(router, 'get', '/', {
        headers: { 'x-api-key': READ_KEY },
        query: { environment: 'niete', native: '1206', deviceId: 'd1' },
      });
      expect(mockStorage.signBundleUrl).toHaveBeenCalled();
      expect(r.body.bundle.url).toContain('signed=1');
    });

    it('a device already on the newest eligible bundle is told there is nothing new', async () => {
      const r = await call(router, 'get', '/', {
        headers: { 'x-api-key': READ_KEY },
        query: {
          environment: 'niete', native: '1206', deviceId: 'd1',
          current: '8',
        },
      });
      expect(r.statusCode).toBe(204);
    });
  });

  describe('apply telemetry', () => {
    it('accepts a failure report — the signal staged rollout depends on', async () => {
      const r = await call(router, 'post', '/telemetry', {
        headers: { 'x-api-key': READ_KEY },
        body: {
          deviceId: 'd1', bundleVersion: 8, environment: 'niete',
          outcome: 'failed', detail: 'checksum mismatch',
        },
      });
      expect(r.statusCode).toBe(202);
      expect(inserted.some((i) => i.table === 'frontend_bundle_events')).toBe(true);
    });

    it('rejects an unrecognised outcome rather than storing garbage', async () => {
      const r = await call(router, 'post', '/telemetry', {
        headers: { 'x-api-key': READ_KEY },
        body: { deviceId: 'd1', bundleVersion: 8, environment: 'niete', outcome: 'banana' },
      });
      expect(r.statusCode).toBe(400);
    });
  });
});
