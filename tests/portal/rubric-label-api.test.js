'use strict';
/**
 * bd-ra8xu.43 — GET /api/portal/coaching-session/:id carries `rubric`: the rubric that session was scored with, read
 * from what was stored (operator 11 Nov ~18:15: "show its rubric id … for ease of debugging"), never the live switch.
 */
require('../fixtures/portal-auth-live').installLivePortalAccounts();

let tableRows;
let tableErrors;
let selects;

const VR = '../../bot/shared/services/coaching/video-reco';

function makeChain(table) {
  const tests = [];
  const run = () => (tableRows[table] || []).filter((r) => tests.every((t) => t(r))).map((r) => ({ ...r }));
  const result = () => (tableErrors[table] ? { data: null, error: { message: tableErrors[table] } } : { data: run()[0] || null, error: null });
  const chain = {
    select: (c) => { (selects[table] = selects[table] || []).push(c || ''); return chain; },
    eq: (c, v) => { tests.push((r) => r[c] === v); return chain; },
    in: (c, vs) => { tests.push((r) => vs.includes(r[c])); return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => result(),
    then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
  };
  chain.single = chain.maybeSingle;
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method.toUpperCase()} ${path}`);
}

async function getSession(userId, id) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', '/coaching-session/:id');
  const req = { session: { portalUserId: userId, id: 'sess-1' }, params: { id }, body: {}, query: {}, method: 'GET', headers: {}, get: () => undefined };
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
const SID = '7a1d2c3b-2222-4333-8444-555555555555';
beforeEach(() => {
  jest.resetModules();
  tableRows = {
    app_settings: [],
    coaching_sessions: [{ id: SID, user_id: UID, status: 'completed', created_at: '2026-10-20T09:00:00Z', analysis_data: null, report_pdf_url: 'https://r2.example/r.png' }],
    video_recommendations: [],
    training_modules: [{ id: 3, title: 'Module three' }],
  };
  tableErrors = {};
  selects = {};
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush: jest.fn(), isEnabled: () => false }));
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

const v3 = { framework: 'fico', domains: { high_leverage_practices: { indicators: [{ id: 'C1', score: 3 }, { id: 'C2', score: 4 }] } } };
const setAnalysis = (analysis_data, extra = {}) => { Object.assign(tableRows.coaching_sessions[0], { analysis_data, ...extra }); };

describe('the session payload names its stored rubric', () => {
  test('a V3 FICO session → FICO V3', async () => {
    setAnalysis(v3, { framework: 'fico' });
    const { payload } = await getSession(UID, SID);
    expect(payload.session.rubric).toBe('FICO V3');
  });
  test('an /observe2 v6 visit → FICO17 v6 (framework + version only), though framework says fico', async () => {
    setAnalysis({ ...v3, observe2: { rubric: 'fico17_v6', prompt_version: 'fico17-v6-coach-1+3191bbae' } }, { framework: 'fico' });
    const { payload } = await getSession(UID, SID);
    expect(payload.session.rubric).toBe('FICO17 v6');
  });
  test('an /observe v6 visit → FICO17 v6', async () => {
    setAnalysis({ framework: 'fico17_v6', rubric: 'fico17_v6', prompt_version: 'fico17-v6-dc-1+3191bbae', domains: {} }, { framework: 'fico17_v6' });
    const { payload } = await getSession(UID, SID);
    expect(payload.session.rubric).toBe('FICO17 v6');
  });
  test('nothing scored yet → null, never a guess', async () => {
    setAnalysis(null, { framework: null });
    const { payload } = await getSession(UID, SID);
    expect(payload.session.rubric).toBeNull();
  });
});
