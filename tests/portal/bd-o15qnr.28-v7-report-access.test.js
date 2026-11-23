/**
 * bd-o15qnr.28 (queue #204, v7) — ONE feedback page for coaches AND principals: the visit's feedback opens the debrief
 * report (coach "Your debrief report", principal "Your feedback"). Its read, GET /api/portal/coach/report/:id (and its
 * "opened" stamp), was the coach app's alone (portal_coach_v2 + coach_reports_app). Now it also opens for:
 *   - a coach on portal_coach_v2 whom portal_coach_flow_v2 names (the v6/v7 switch), coach_reports_app or not;
 *   - a principal on the principal app whom portal_coach_flow_v2 names.
 * Everyone else reads exactly as before (404). The service still decides whose report it is (the session user must be
 * the observer), so nobody reads another person's report. The weekly report stays the coach's (no week for principals).
 */
process.env.FLAG_CACHE_TTL_MS = '0';

const COACH = 'c-1';
const PRINCIPAL = 'p-1';
const USERS = {
  [COACH]: { id: COACH, role: 'coach', school_id: 'school-1', phone_number: '923000000001' },
  [PRINCIPAL]: { id: PRINCIPAL, role: 'principal', school_id: 'school-1126', phone_number: '923000000002' },
};
let settings;
let reportCalls;

function fakeSupabase() {
  return {
    from(table) {
      let key = null;
      const chain = {
        select: () => chain, eq: (_c, v) => { key = v; return chain; }, is: () => chain, in: () => chain, order: () => chain, limit: () => chain,
        maybeSingle: async () => {
          if (table === 'users') return { data: Object.prototype.hasOwnProperty.call(USERS, key) ? USERS[key] : null, error: null };
          if (table === 'app_settings') return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
          return { data: null, error: null };
        },
      };
      chain.single = chain.maybeSingle;
      return chain;
    },
    rpc: jest.fn(async () => ({ data: null, error: null })),
  };
}

beforeEach(() => {
  settings = {};
  reportCalls = [];
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.doMock('../../dashboard/config/supabase', () => fakeSupabase());
  jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
  jest.doMock('../../dashboard/services/r2.service', () => ({ generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn() }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  const real = jest.requireActual('../../dashboard/services/coach-report.service');
  jest.doMock('../../dashboard/services/coach-report.service', () => ({
    ...real,
    getCoachReport: jest.fn(async (_q, userId, id) => { reportCalls.push([userId, id]); return { status: 'ok', report: { id } }; }),
    markCoachReport: jest.fn(async () => true),
  }));
  const realWeek = jest.requireActual('../../dashboard/services/coach-week.service');
  jest.doMock('../../dashboard/services/coach-week.service', () => ({
    ...realWeek, getCoachWeek: jest.fn(async () => ({ status: 'ok', week: { monday: '2026-11-16' } })),
  }));
});
afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

async function call(method, path, params, userId) {
  const routes = require('../../dashboard/routes/portal.routes');
  const layer = routes.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`no ${method} ${path}`);
  const req = { params, body: {}, query: {}, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
    session: { portalUserId: userId, id: 's' } };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; }, set() { return this; } };
  for (const h of layer.route.stack.map((x) => x.handle)) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await h(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}
const RID = '11111111-2222-4333-8444-555555555555';
const report = (userId) => call('get', '/coach/report/:id', { id: RID }, userId);

describe('GET /coach/report/:id — who may open the one feedback page', () => {
  test('a coach on the coach app and coach_reports_app: as before', async () => {
    settings = { portal_coach_v2: [COACH], coach_reports_app: [COACH] };
    expect((await report(COACH)).statusCode).toBe(200);
    expect(reportCalls).toEqual([[COACH, RID]]);
  });

  test('a coach on the coach app whom the v6/v7 switch names, without coach_reports_app: opens', async () => {
    settings = { portal_coach_v2: [COACH], portal_coach_flow_v2: [COACH] };
    const out = await report(COACH);
    expect(out.statusCode).toBe(200);
    expect(out.payload.report.id).toBe(RID);
  });

  test('a coach on neither switch: 404, nothing read', async () => {
    settings = { portal_coach_v2: [COACH] };
    expect((await report(COACH)).statusCode).toBe(404);
    expect(reportCalls).toEqual([]);
  });

  test('a principal on the principal app whom the switch names: opens (her own report: the service checks)', async () => {
    settings = { portal_principal_app: [PRINCIPAL], portal_coach_flow_v2: [PRINCIPAL] };
    expect((await report(PRINCIPAL)).statusCode).toBe(200);
    expect(reportCalls).toEqual([[PRINCIPAL, RID]]);
  });

  test('a principal on the app but not the switch, or on the switch but not the app: 404', async () => {
    settings = { portal_principal_app: [PRINCIPAL] };
    expect((await report(PRINCIPAL)).statusCode).toBe(404);
    settings = { portal_coach_flow_v2: [PRINCIPAL] };
    jest.resetModules();
    expect((await report(PRINCIPAL)).statusCode).toBe(404);
    expect(reportCalls).toEqual([]);
  });

  test('"opened" follows the same rule', async () => {
    settings = { portal_principal_app: [PRINCIPAL], portal_coach_flow_v2: [PRINCIPAL] };
    expect((await call('post', '/coach/report/:id/opened', { id: RID }, PRINCIPAL)).statusCode).toBe(200);
  });

  test('the weekly report stays the coach app\'s: a principal on the switch gets 404', async () => {
    settings = { portal_principal_app: [PRINCIPAL], portal_coach_flow_v2: [PRINCIPAL] };
    expect((await call('get', '/coach/week/:monday', { monday: '2026-11-16' }, PRINCIPAL)).statusCode).toBe(404);
  });
});
