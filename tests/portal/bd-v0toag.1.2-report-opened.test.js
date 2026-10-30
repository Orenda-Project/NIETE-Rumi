'use strict';
/**
 * bd-v0toag.1.2 — coaching.report.opened: the teacher opened her coaching report in the portal
 * (GET /api/portal/coaching-session/:id — the route only serves HER session). Portal-side events go through
 * dashboard telemetry (no correlation context in this process). A session with no report yet, or a session
 * that is not hers, logs nothing. WhatsApp read receipts are not used.
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

let tableRows;
let selects;
let telemetry;

function applySlices(row) { return { ...row }; }

/** A chain that filters `tableRows[table]` the way PostgREST would for the calls these routes make. */
function makeChain(table) {
  const tests = [];
  let order = null;
  let cap = Infinity;
  let cols = '';
  const run = () => {
    let rows = (tableRows[table] || []).filter((r) => tests.every((t) => t(r)));
    if (order) rows = [...rows].sort((a, b) => (a[order.col] < b[order.col] ? -1 : 1) * (order.asc ? 1 : -1));
    return rows.slice(0, cap).map((r) => applySlices(r, cols));
  };
  const chain = {
    select: (c) => { cols = c || ''; (selects[table] = selects[table] || []).push(cols); return chain; },
    eq: (c, v) => { tests.push((r) => r[c] === v); return chain; },
    in: (c, vs) => { tests.push((r) => vs.includes(r[c])); return chain; },
    not: (c, op, v) => {
      if (op === 'is') tests.push((r) => r[c] !== v && r[c] !== undefined);
      if (op === 'in') {
        const vs = String(v).replace(/[()]/g, '').split(',');
        tests.push((r) => !vs.includes(r[c]));
      }
      return chain;
    },
    // PostgREST or=(col.op.value,…): the teacher routes keep a coach's unsent
    // observation out (bd-5rz1v.6.4). is/eq/neq, with SQL's NULL semantics.
    or: (expr) => {
      const terms = String(expr).split(',').map((t) => {
        const m = t.match(/^(.+?)\.(is|eq|neq)\.(.+)$/);
        return (r) => {
          const v = m[1].split(/->>?/).reduce((o, k, i) => (i === 0 ? r[k] : (o && typeof o === 'object' ? o[k] : undefined)), undefined);
          if (m[2] === 'is') return m[3] === 'null' ? v == null : String(v) === m[3];
          if (m[2] === 'eq') return v != null && String(v) === m[3];
          return v != null && String(v) !== m[3];
        };
      });
      tests.push((r) => terms.some((t) => t(r)));
      return chain;
    },
    gte: (c, v) => { tests.push((r) => r[c] >= v); return chain; },
    order: (col, opts = {}) => { order = { col, asc: opts.ascending !== false }; return chain; },
    limit: (n) => { cap = n; return chain; },
    range: (a, b) => { cap = b - a + 1; return chain; },
    maybeSingle: async () => ({ data: run()[0] || null, error: null }),
    then: (res, rej) => Promise.resolve({ data: run(), error: null, count: run().length }).then(res, rej),
  };
  chain.single = chain.maybeSingle;
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  throw new Error(`no ${method.toUpperCase()} ${path}`);
}

async function invoke(method, path, { userId = 'teacher-1', params = {}, body = {}, query = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
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

const UID = '0b9c3f1e-1111-4222-8333-444444444444';

beforeEach(() => {
  jest.resetModules();
  tableRows = { app_settings: [] };
  selects = {};
  telemetry = { logEvent: jest.fn(), flush: jest.fn(), isEnabled: () => false };
  jest.doMock('../../dashboard/services/telemetry.service', () => telemetry);
  jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('../../dashboard/services/coaching-breakdown.service', () => ({ breakdown: jest.fn().mockResolvedValue(null) }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});
afterEach(() => jest.resetModules());

const opened = () => telemetry.logEvent.mock.calls.filter((c) => c[0] === 'coaching.report.opened').map((c) => c[1]);
const row = (extra) => ({ id: 'cs-1', user_id: UID, status: 'completed', created_at: '2026-10-15T09:00:00Z', analysis_data: null, ...extra });

test('her report opened in the portal: one opened event, uuid + session + surface', async () => {
  tableRows.coaching_sessions = [row({ report_pdf_url: 'https://r2.example/r.png' })];
  const { statusCode } = await invoke('get', '/coaching-session/:id', { userId: UID, params: { id: 'cs-1' } });
  expect(statusCode).toBe(200);
  expect(opened()).toEqual([{ userId: UID, sessionId: 'cs-1', surface: 'portal' }]);
});

test('no report yet (still analysing): the page opened, but no report did — nothing logged', async () => {
  tableRows.coaching_sessions = [row({ status: 'analyzing' })];
  await invoke('get', '/coaching-session/:id', { userId: UID, params: { id: 'cs-1' } });
  expect(opened()).toEqual([]);
});

test('not her session (404): nothing logged', async () => {
  tableRows.coaching_sessions = [row({ user_id: 'someone-else', report_pdf_url: 'x' })];
  const { statusCode } = await invoke('get', '/coaching-session/:id', { userId: UID, params: { id: 'cs-1' } });
  expect(statusCode).toBe(404);
  expect(opened()).toEqual([]);
});
