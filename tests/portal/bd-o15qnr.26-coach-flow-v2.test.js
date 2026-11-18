/**
 * bd-o15qnr.26 — the coach visit flow v2 (Option A): app_settings `portal_coach_flow_v2` makes Schedule the one open list
 * of a coach's visits (Cancel visit on each row), the menu's Observe "Observations", New visit's level chips and the
 * Home's Today card. Same shape and fail-closed rule as the other per-user keys (isFlagEnabledForUser): a list of
 * users.id = those users, true = everyone, no row, anything else, a failed read or no session = OFF.
 *
 * /api/portal/config carries it as `features.coachFlowV2`, only with the coach app v2 AND the full coach app on for her:
 * it reworks the Schedule and Observe screens, which only those open. Its error fallback says false.
 *
 * POST /api/portal/funnel/coach-flow — what she does on it, for the funnel (app_funnel.coach_flow), with the user and
 * journey from the SESSION and only known values.
 */
const http = require('http');
const express = require('express');

const { PORTAL_COACH_FLOW_V2_KEY } = require('../../dashboard/lib/feature-flags');

describe('portal_coach_flow_v2 — the key', () => {
  test('its own app_settings key', () => {
    expect(PORTAL_COACH_FLOW_V2_KEY).toBe('portal_coach_flow_v2');
  });
});

/* ── GET /config ────────────────────────────────────────────────────────── */

let settings;

function makeChain(table) {
  let key = null;
  const chain = {
    select: () => chain,
    eq: (_col, val) => { key = val; return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      if (table === 'app_settings') {
        return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
      }
      return { data: null, error: null };
    },
  };
  chain.single = chain.maybeSingle;
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method} ${path}`);
}

async function getConfig({ userId = 'hina', sessionThrows = false } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', '/config');
  const req = { params: {}, body: {}, query: {}, method: 'GET', path: '/config', ip: '127.0.0.1', headers: {}, get: () => undefined };
  if (sessionThrows) Object.defineProperty(req, 'session', { get() { throw new Error('session store down'); } });
  else req.session = userId ? { portalUserId: userId, id: 's' } : {};
  let payload = null;
  let statusCode = 200;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const h of stack) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await h(req, res, () => { next = true; });
      if (!next) break;
    }
  } finally {
    errors.mockRestore();
  }
  return { statusCode, payload };
}

describe('GET /config — features.coachFlowV2', () => {
  beforeEach(() => {
    jest.resetModules();
    settings = {};
    jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
    jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
    jest.doMock('../../dashboard/services/r2.service', () => ({ generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn() }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  });
  afterEach(() => jest.resetModules());

  test('a list: true for the coach it names (coach v2 and the full app on), false for another coach', async () => {
    settings.portal_coach_v2 = true;
    settings.portal_coach_full_app = true;
    settings.portal_coach_flow_v2 = ['hina'];
    expect((await getConfig({ userId: 'hina' })).payload.features.coachFlowV2).toBe(true);
    expect((await getConfig({ userId: 'other-coach' })).payload.features.coachFlowV2).toBe(false);
  });

  test('the full coach app off for her: false, even when listed (the screens it changes are not hers)', async () => {
    settings.portal_coach_v2 = true;
    settings.portal_coach_full_app = ['someone-else'];
    settings.portal_coach_flow_v2 = ['hina'];
    expect((await getConfig({ userId: 'hina' })).payload.features.coachFlowV2).toBe(false);
  });

  test('coach v2 off for her: false, even when listed', async () => {
    settings.portal_coach_v2 = ['someone-else'];
    settings.portal_coach_full_app = true;
    settings.portal_coach_flow_v2 = true;
    expect((await getConfig({ userId: 'hina' })).payload.features.coachFlowV2).toBe(false);
  });

  test('absent, an object, a number, "yes" or an empty list: a real false', async () => {
    settings.portal_coach_v2 = true;
    settings.portal_coach_full_app = true;
    expect((await getConfig()).payload.features).toHaveProperty('coachFlowV2', false);
    for (const v of [{ hina: true }, 1, 'yes', []]) {
      settings.portal_coach_flow_v2 = v;
      // eslint-disable-next-line no-await-in-loop
      expect((await getConfig()).payload.features.coachFlowV2).toBe(false);
    }
  });

  test('logged out: false', async () => {
    settings.portal_coach_v2 = true;
    settings.portal_coach_full_app = true;
    settings.portal_coach_flow_v2 = true;
    expect((await getConfig({ userId: null })).payload.features.coachFlowV2).toBe(false);
  });

  test('the error fallback says coachFlowV2: false', async () => {
    settings.portal_coach_flow_v2 = true;
    const { statusCode, payload } = await getConfig({ sessionThrows: true });
    expect(statusCode).toBe(200);
    expect(payload.features).toHaveProperty('coachFlowV2', false);
  });
});

/* ── POST /funnel/coach-flow ─────────────────────────────────────────────── */

const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const OTHER = '11111111-1111-4111-8111-111111111111';
const JOURNEY = 'j_0123456789abcdef';

describe('POST /funnel/coach-flow', () => {
  let emitted;
  let servers = [];
  beforeEach(() => {
    jest.resetModules();
    emitted = [];
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  });
  afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

  async function app({ session = { id: 'sess-1', portalUserId: USER, appJourney: { id: JOURNEY, at: Date.now(), feature: 'coach_observe' } } } = {}) {
    const a = express();
    a.use((req, _res, next) => { if (session) req.session = { ...session }; next(); });
    a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').createAppFunnelRouter({}));
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);
    return srv;
  }
  const post = (srv, body) => new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/portal/funnel/coach-flow', method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject); req.write(data); req.end();
  });

  test.each(['schedule.cancel_tap', 'schedule.cancel_confirm', 'schedule.start', 'home.today_start'])('%s → app_funnel.coach_flow, user and journey from the session', async (a) => {
    const res = await post(await app(), { a, userId: OTHER });
    expect(res.status).toBe(204);
    const row = emitted.find((x) => x.e === 'app_funnel.coach_flow');
    expect(row.d).toEqual(expect.objectContaining({ userId: USER, journeyId: JOURNEY, feature: 'schedule', action: a, level: null }));
    expect(JSON.stringify(row.d)).not.toContain(OTHER);
  });

  test('new_visit.level carries the level (all / primary / middle / high), anything else is unknown', async () => {
    const srv = await app();
    await post(srv, { a: 'new_visit.level', level: 'primary' });
    await post(srv, { a: 'new_visit.level', level: '<x>' });
    const rows = emitted.filter((x) => x.e === 'app_funnel.coach_flow').map((x) => x.d.level);
    expect(rows).toEqual(['primary', 'unknown']);
  });

  test('an unknown action or a bad body is 400 (nothing logged); signed out is 401', async () => {
    const srv = await app();
    expect((await post(srv, { a: 'schedule.delete' })).status).toBe(400);
    expect((await post(srv, 'not json')).status).toBe(400);
    expect(emitted).toHaveLength(0);
    expect((await post(await app({ session: null }), { a: 'schedule.start' })).status).toBe(401);
  });
});
