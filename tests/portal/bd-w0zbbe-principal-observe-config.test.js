/**
 * bd-w0zbbe (queue #147) — /config shows the portal's observe page to exactly who the observe API lets in.
 *
 * Production, 16 Nov: a principal (an internal tester switched to principal) opened Observations, saw "Record your
 * Teacher's Lesson", recorded, and every upload answered 404 — shown as "The internet stopped". The observe API admits
 * a principal only when portal_principal_app names her (requireCoachObservation), but /config answered
 * coachObservation from portal_coach_observation alone (true for everyone on prod), and the record page also opened
 * on coachV2 (true for everyone). Seven other principal devices hit the same 404 since 11 Nov.
 * The operator: principals' observation is on WhatsApp only (unless the principal app names them).
 *
 * Now /config answers, per signed-in user, what the gate answers: observeOnPortal (the record page) and coachObservation
 * (the Observations page's button and list) are false for a principal not on the principal app — the page then says
 * "Schedule and debrief with /observe on WhatsApp". Coaches are exactly as before.
 * (Harness copied from bd-33wxxi.4-principal-observe-gate.test.js.)
 */

let tableRows;
let client;

function makeChain(table) {
  const tests = [];
  const run = () => (tableRows[table] || []).filter((r) => tests.every((t) => t(r)));
  const chain = {
    select: () => chain,
    eq: (c, v) => { tests.push((r) => r[c] === v); return chain; },
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: run()[0] || null, error: null }),
    single: async () => {
      const r = run()[0] || null;
      return { data: r, error: r ? null : { code: 'PGRST116', message: 'no rows' } };
    },
    then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
  };
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

async function invoke(method, path, { userId = 'coach-1', params = {}, body = {}, query = {} } = {}) {
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

const ok = (body = {}) => jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', ...body } });

beforeEach(() => {
  jest.resetModules();
  tableRows = {
    app_settings: [{ key: 'portal_coach_observation', value: ['coach-1'] }],
    users: [{ id: 'coach-1', role: 'coach' }, { id: 'teacher-1', role: 'teacher' }, { id: 'coach-2', role: 'coach' }],
  };
  client = {
    presignUpload: ok({ key: 'k', uploadUrl: 'u', contentType: 'audio/webm' }),
    startSession: jest.fn(),
    submitReflection: jest.fn(),
    recentPlans: jest.fn(),
    startObservation: ok({ coachingSessionId: 'cs-1' }),
    observeRecentPlans: ok({ plans: [] }),
    listObservations: ok({ observations: [] }),
    observationView: ok({ id: 'cs-1', step: 'draft' }),
    getObservationDraft: ok({ sections: [] }),
    saveObservationDraft: ok({ summary: {} }),
    observationTalkGuide: ok({ guide: {} }),
    startObservationTalk: ok(),
    retryObservationTalk: ok(),
    previewObservationReport: ok(),
    sendObservationReport: ok(),
  };
  jest.doMock('../../dashboard/services/portal-coaching.client', () => client);
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});
afterEach(() => jest.resetModules());


process.env.FLAG_CACHE_TTL_MS = '0';

const setFlag = (key, value) => {
  tableRows.app_settings = tableRows.app_settings.filter((r) => r.key !== key);
  if (value !== undefined) tableRows.app_settings.push({ key, value });
};
const config = async (userId) => (await invoke('get', '/config', { userId })).payload.features;

describe('/config and the observe page, per role', () => {
  beforeEach(() => {
    tableRows.users.push({ id: 'principal-1', role: 'principal', school_id: 's-1' }, { id: 'principal-2', role: 'principal', school_id: 's-1' });
    setFlag('portal_coach_observation', true); // production today
    setFlag('portal_coach_v2', true); // production today
    setFlag('portal_principal_app', ['principal-2']);
  });

  test('a principal NOT on the principal app: no observe page, no Observations button (the API would 404 her)', async () => {
    const f = await config('principal-1');
    expect(f.observeOnPortal).toBe(false);
    expect(f.coachObservation).toBe(false);
    const gate = await invoke('post', '/leader/observe-upload/presign', { userId: 'principal-1', body: { filename: 'a.webm', sizeBytes: 10, kind: 'audio' } });
    expect(gate.statusCode).toBe(404);
  });

  test('a principal ON the principal app: the observe page is hers, as the API agrees', async () => {
    const f = await config('principal-2');
    expect(f.observeOnPortal).toBe(true);
    expect(f.coachObservation).toBe(true);
    const gate = await invoke('post', '/leader/observe-upload/presign', { userId: 'principal-2', body: { filename: 'a.webm', sizeBytes: 10, kind: 'audio' } });
    expect(gate.statusCode).toBe(200);
  });

  test('a coach is unchanged: observe page on (either pilot flag), coachObservation as its own flag says', async () => {
    let f = await config('coach-1');
    expect(f.observeOnPortal).toBe(true);
    expect(f.coachObservation).toBe(true);
    setFlag('portal_coach_observation', false);
    f = await config('coach-1');
    expect(f.coachObservation).toBe(false);
    expect(f.observeOnPortal).toBe(true); // coach v2's Take observation still runs on this pipeline
  });

  test('signed out: off', async () => {
    const f = await config(null);
    expect(f.observeOnPortal).toBe(false);
  });
});
