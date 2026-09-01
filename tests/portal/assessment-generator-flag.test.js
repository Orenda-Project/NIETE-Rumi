/**
 * bd-2460 — the Assessment Generator must be OFF on both surfaces until it is
 * ready on both.
 *
 * Today it is live and ungated on the portal (Curriculum → Assessment
 * Generator tab, no feature check anywhere) while the bot's /assessment command
 * falls back to "The assessment generator is being prepared for you." because
 * ASSESSMENT_GEN_FLOW_ID is not set for this deployment. Two surfaces, two
 * different answers to "can I use this?".
 *
 * The switch is ONE row in app_settings — the table already used for config
 * flags (pic_lp_backend_ab) — because the bot and the dashboard are separate
 * Railway services with separate env, but share one Supabase. An env var would
 * have to be set twice and could drift; a DB row cannot.
 *
 * Contract:
 *   1. FAIL CLOSED. Absent row, malformed value, or a failed lookup all mean
 *      OFF. Turning the feature ON must be a deliberate act, and a database
 *      hiccup must never silently expose an unfinished feature.
 *   2. The refusal carries the SAME wording the bot sends, so a teacher who
 *      tries both surfaces gets one consistent answer.
 *   3. value: true reports it as available.
 *
 * bd-59814 narrowed this file. The portal's /assessment/generate and
 * /assessment/status endpoints were deleted with the UG_EG-backed
 * implementation, so the cases that gated THEM went with them. What remains is
 * the part that still has a subject: /config, which is what the browser reads
 * to decide whether to offer the feature at all. The flag itself is unchanged
 * and still fail-closed — it is the switch the rebuild ships dark behind.
 */

let supabaseFrom;
let tableStates;

const MESSAGE_RE = /being prepared|not.*available yet|notify you when/i;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {} };
  const chain = {};
  const rowsNow = () => {
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) rows = rows.filter(r => val.in.includes(r[col]));
      else rows = rows.filter(r => r[col] === val);
    }
    return rows;
  };
  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    return { data: rowsNow()[0] || null, error: null };
  };
  chain.select = jest.fn(() => chain);
  chain.insert = jest.fn(() => chain);
  chain.update = jest.fn(() => chain);
  chain.upsert = jest.fn(() => chain);
  ['eq', 'neq', 'is', 'not', 'gt', 'lt', 'gte', 'lte'].forEach(m => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (res, rej) => Promise.resolve({ data: rowsNow(), error: state.error || null }).then(res, rej);
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map(s => s.handle);
    }
  }
  return null;
}

async function invoke(method, path, { userId = 'user-1', params = {}, body = {}, query = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query, method: method.toUpperCase(), path, ip: '127.0.0.1',
    headers: { host: 'portal.example.com' }, get: (h) => (h === 'host' ? 'portal.example.com' : undefined),
    protocol: 'https',
  };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

/** @param {undefined|boolean|string|object} value what app_settings holds, or undefined for no row */
function setFlag(value) {
  tableStates.app_settings = {
    rows: value === undefined ? [] : [{ key: 'assessment_generator_enabled', value }],
  };
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  setFlag(undefined);

  supabaseFrom = jest.fn((t) => makeChain(t));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: supabaseFrom, rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue('https://r2/signed'),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  jest.doMock('pg', () => ({ Pool: jest.fn(() => ({ query: jest.fn(), on: jest.fn() })) }), { virtual: true });
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });

});

afterEach(() => jest.resetModules());

const VALID_SPEC = {
  generationType: 'exam', grade: '5', subject: 'Maths',
  pageRanges: '1-10', contentSource: 'Seen',
  questionTypes: [{ id: 'mcq', count: 5, category: 'objective' }],
};

describe('bd-2460 — the portal tells the browser what is available', () => {
  it('reports the generator as unavailable while off', async () => {
    setFlag(undefined);

    const { statusCode, payload } = await invoke('get', '/config');

    expect(statusCode).toBe(200);
    expect(payload.features.assessmentGenerator).toBe(false);
  });

  it('ships the message the UI should show, matching the bot wording', async () => {
    setFlag(undefined);

    const { payload } = await invoke('get', '/config');

    expect(String(payload.features.assessmentGeneratorMessage)).toMatch(MESSAGE_RE);
  });

  it('reports it as available when the flag is true', async () => {
    setFlag(true);

    const { payload } = await invoke('get', '/config');

    expect(payload.features.assessmentGenerator).toBe(true);
  });
});
