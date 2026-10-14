'use strict';
/**
 * GET /api/internal/lp/health — the lesson-plan health numbers on demand: the same last-hour summary the
 * hourly check emits, for an engineer or a monitor to ask for. Behind the internal key (per-path counts
 * are not for the open internet); a no-op until LP_LIFECYCLE_PATHS switches a path on; 503 when the read
 * fails, so a monitor can tell "we are broken" from "nothing happened".
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));

const { createMemorySupabase } = require('../quiz/helpers/memory-supabase');

let mockDb;
let mockCalls = 0;
let mockFailReads = false;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => {
    mockCalls += 1;
    if (mockFailReads) {
      const err = { data: null, error: { code: '57014', message: 'statement timeout' }, count: null };
      const b = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => Promise.resolve(err).then(res) : () => b) });
      return b;
    }
    return mockDb.from(t);
  },
}));

const KEY = 'internal-test-key';
process.env.INTERNAL_API_KEY = KEY;
const router = require('../../bot/shared/routes/internal-api.routes');

function findRoute(method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`route ${method.toUpperCase()} ${path} not found`);
}
async function getHealth(headers = { 'x-api-key': KEY }) {
  const stack = findRoute('get', '/lp/health');
  const req = { headers, body: {}, query: {}, ip: '127.0.0.1', method: 'GET', path: '/lp/health' };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const handler of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const ask = (over = {}) => ({
  id: `r-${Math.random()}`, source: 'niete_v8_segment', channel: 'portal', status: 'completed', error_code: null,
  created_at: ago(10), delivered_at: ago(9.9), ...over,
});

let savedPaths;
beforeEach(() => {
  savedPaths = process.env.LP_LIFECYCLE_PATHS;
  delete process.env.LP_LIFECYCLE_PATHS;
  mockCalls = 0;
  mockFailReads = false;
  mockDb = createMemorySupabase({ lesson_plan_requests: [ask(), ask({ status: 'failed', error_code: 'NO_ASSET', delivered_at: null })] });
});
afterEach(() => {
  if (savedPaths === undefined) delete process.env.LP_LIFECYCLE_PATHS; else process.env.LP_LIFECYCLE_PATHS = savedPaths;
});

test('without the internal key: 401, and nothing is read', async () => {
  process.env.LP_LIFECYCLE_PATHS = 'all';
  const { statusCode } = await getHealth({});
  expect(statusCode).toBe(401);
  expect(mockCalls).toBe(0);
});

test('switched off: { status: off } and no database call', async () => {
  const { statusCode, payload } = await getHealth();
  expect(statusCode).toBe(200);
  expect(payload).toEqual({ success: true, status: 'off' });
  expect(mockCalls).toBe(0);
});

test('switched on: the last hour per path and channel, and the verdict', async () => {
  process.env.LP_LIFECYCLE_PATHS = 'all';
  const { statusCode, payload } = await getHealth();
  expect(statusCode).toBe(200);
  expect(payload).toEqual(expect.objectContaining({ success: true, status: 'healthy', windowMin: 60, stuck: 0, reasons: [] }));
  expect(payload.sources).toEqual([expect.objectContaining({
    source: 'niete_v8_segment', channel: 'portal', asks: 2, delivered: 1, failed: 1, codes: { NO_ASSET: 1 },
  })]);
});

test('a stuck request makes it degraded', async () => {
  process.env.LP_LIFECYCLE_PATHS = 'all';
  mockDb.tables.lesson_plan_requests.push(ask({ source: 'homework_bundle', channel: 'whatsapp', status: 'pending', delivered_at: null, created_at: ago(8 * 60) }));
  const { payload } = await getHealth();
  expect(payload).toEqual(expect.objectContaining({ status: 'degraded', reasons: ['stuck'], stuck: 1 }));
});

test('a read that fails answers 503 — broken is not the same as quiet', async () => {
  process.env.LP_LIFECYCLE_PATHS = 'all';
  mockFailReads = true;
  const { statusCode, payload } = await getHealth();
  expect(statusCode).toBe(503);
  expect(payload).toEqual(expect.objectContaining({ success: false, status: 'read_failed' }));
});
