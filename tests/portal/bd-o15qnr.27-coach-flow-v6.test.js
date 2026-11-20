/**
 * bd-o15qnr.27 (queue #204) — the coach flow v6, server half.
 *
 * 1. "Schedule for Now" books the visit for this half hour while the coach is already in the class. v6 says the teacher
 *    gets no message ("Mehwish gets no message."), and #188's audit found the built "Start an observation" sent the
 *    teacher a "visit scheduled" WhatsApp and the coach a calendar invite mid-observation. A booking posted with
 *    `now: true` (a literal true; the v6 Now path is the only sender) announces NOTHING, as a past-dated booking already
 *    does. "Schedule for Later" (no `now`) is announced exactly as before.
 *
 * 2. The funnel (POST /funnel/coach-flow) takes v6's new actions: Schedule an observation on Observe, Now's Start
 *    recording / Upload recording, Later's Schedule, the Home Focus card's button, All booked opened on Observe.
 */
const http = require('http');
const express = require('express');

jest.mock('axios', () => ({ post: jest.fn() }));

/* ── 1. POST /leader/schedules with now: true ─────────────────────────────── */

let announce;
let createResult;

function loadRoutes() {
  jest.resetModules();
  announce = jest.fn();
  jest.doMock('../../dashboard/config/supabase', () => ({ from: () => ({}), rpc: jest.fn() }));
  jest.doMock('../../dashboard/config/database', () => ({ query: jest.fn() }));
  jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  jest.doMock('../../dashboard/services/observe-notice.service', () => ({ notifyTeacher: announce }));
  jest.doMock('../../dashboard/services/leader-schedule-write.service', () => ({
    createSchedule: jest.fn(async () => createResult),
    cancelSchedule: jest.fn(async (_q, _l, id) => ({ id, cancelled: true })),
    SLOTS: [], validDate: () => true,
  }));
  return require('../../dashboard/routes/portal.routes');
}

async function book(result, extra = {}) {
  createResult = result;
  const router = loadRoutes();
  const layer = router.stack.find((l) => l.route && l.route.path === '/leader/schedules' && l.route.methods.post);
  const stack = layer.route.stack.map((s) => s.handle);
  const res = { status() { return this; }, json(b) { this.body = b; return this; } };
  const body = { teacherExtId: '923990000101', date: '2026-11-20', slot: '09:30', ...extra };
  await stack[stack.length - 1]({ body, params: {}, session: { portalUserId: 'coach-1' } }, res);
  return res.body;
}

describe('Schedule for Now (now: true): the teacher gets no message, the coach no invite', () => {
  test('a new booking for now: booked, nothing announced', async () => {
    const out = await book({ id: 'now-1', updated: false, changed: true, past: false }, { now: true });
    expect(out).toEqual(expect.objectContaining({ success: true, id: 'now-1' }));
    expect(announce).not.toHaveBeenCalled();
  });

  test('re-timing her booking to now: nothing announced either', async () => {
    await book({ id: 'sch-1', updated: true, changed: true, past: false }, { now: true });
    expect(announce).not.toHaveBeenCalled();
  });

  test('only a literal true is Now: "true" or 1 is announced as any booking', async () => {
    await book({ id: 'b-1', updated: false, changed: true, past: false }, { now: 'true' });
    expect(announce.mock.calls).toEqual([[{ scheduleId: 'b-1', leaderUserId: 'coach-1', kind: 'scheduled', moved: true }]]);
    await book({ id: 'b-2', updated: false, changed: true, past: false }, { now: 1 });
    expect(announce.mock.calls).toEqual([[{ scheduleId: 'b-2', leaderUserId: 'coach-1', kind: 'scheduled', moved: true }]]);
  });

  test('Schedule for Later (no now): announced once as "scheduled", as before', async () => {
    await book({ id: 'later-1', updated: false, changed: true, past: false });
    expect(announce.mock.calls).toEqual([[{ scheduleId: 'later-1', leaderUserId: 'coach-1', kind: 'scheduled', moved: true }]]);
  });
});

/* ── 2. POST /funnel/coach-flow: v6's actions ─────────────────────────────── */

const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const JOURNEY = 'j_0123456789abcdef';

describe('POST /funnel/coach-flow — v6 actions', () => {
  let emitted;
  let servers = [];
  beforeEach(() => {
    jest.resetModules();
    emitted = [];
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  });
  afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

  async function app() {
    const a = express();
    a.use((req, _res, next) => { req.session = { id: 'sess-1', portalUserId: USER, appJourney: { id: JOURNEY, at: Date.now(), feature: 'coach_observe' } }; next(); });
    a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').createAppFunnelRouter({}));
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);
    return srv;
  }
  const post = (srv, body) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/portal/funnel/coach-flow', method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject); req.write(data); req.end();
  });

  test.each(['observe.schedule', 'schedule.now_record', 'schedule.now_upload', 'schedule.later', 'home.focus', 'observe.booked_open'])(
    '%s → app_funnel.coach_flow', async (a) => {
      const res = await post(await app(), { a });
      expect(res.status).toBe(204);
      const row = emitted.find((x) => x.e === 'app_funnel.coach_flow');
      expect(row.d).toEqual(expect.objectContaining({ userId: USER, journeyId: JOURNEY, action: a, level: null }));
    },
  );

  test('an unknown action is still a 400 and logs nothing', async () => {
    const res = await post(await app(), { a: 'observe.anything' });
    expect(res.status).toBe(400);
    expect(emitted).toEqual([]);
  });
});

/* ── 3. /config: principalFlowV2, the same switch for a principal on the principal app ─────────────────────────── */

describe('GET /config — principalFlowV2 (bd-o15qnr.27: principals on the portal, the operator 20 Nov ~14:40)', () => {
  const USERS = { 'p-1': { role: 'principal', school_id: 'school-1126' }, 'c-1': { role: 'coach', school_id: 'school-1126' } };
  let settings;
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
    process.env.FLAG_CACHE_TTL_MS = '0';
    settings = { portal_teacher_v2: 'teachers', portal_teacher_home_card: 'teachers', portal_teacher_home_look: 'teachers' };
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.doMock('../../dashboard/config/supabase', () => fakeSupabase());
    jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
    jest.doMock('../../dashboard/services/r2.service', () => ({ generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn() }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  });
  afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

  async function features(userId) {
    const routes = require('../../dashboard/routes/portal.routes');
    const layer = routes.stack.find((l) => l.route && l.route.path === '/config' && l.route.methods.get);
    const req = { params: {}, body: {}, query: {}, method: 'GET', path: '/config', ip: '127.0.0.1', headers: {}, get: () => undefined,
      session: { portalUserId: userId, id: 's' } };
    let payload = null;
    const res = { status() { return this; }, json(b) { payload = b; return this; } };
    for (const h of layer.route.stack.map((x) => x.handle)) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await h(req, res, () => { next = true; });
      if (!next) break;
    }
    return payload.features;
  }

  test('a principal on the principal app, listed on the switch: principalFlowV2 true (coachFlowV2 stays the coach\'s)', async () => {
    settings.portal_coach_flow_v2 = ['p-1'];
    settings.portal_principal_app = ['p-1'];
    const f = await features('p-1');
    expect(f.principalApp).toBe(true);
    expect(f.principalFlowV2).toBe(true);
    expect(f.coachFlowV2).toBe(false);
  });

  test('on the switch but not the principal app, or the app but not the switch: false', async () => {
    settings.portal_coach_flow_v2 = ['p-1'];
    expect((await features('p-1')).principalFlowV2).toBe(false);
    jest.resetModules();
    settings = { ...settings, portal_coach_flow_v2: [], portal_principal_app: ['p-1'] };
    expect((await features('p-1')).principalFlowV2).toBe(false);
  });

  test('a coach on both lists: never principalFlowV2', async () => {
    settings.portal_coach_flow_v2 = ['c-1'];
    settings.portal_principal_app = ['c-1'];
    expect((await features('c-1')).principalFlowV2).toBe(false);
  });
});
