'use strict';
/**
 * bd-9652yj (queue #166) — the coach app's way back to WhatsApp, the portal's half.
 *
 *   POST /api/portal/coach/handoff { screen, visitId? }
 *     → { success: true, code }   a 5-character code (no 0/O/1/I/L) stored 24 h in the shared Redis under
 *                                 coach_handoff:<code> = { u: the SESSION's user, v: the visit when it is hers, s, j, at }
 *     → { success: true, code: null } when Redis is not there: the app still opens the chat (plain /observe)
 *   Only a coach on the coach app (isCoachAppUser: portal_coach_v2 + role coach): anyone else gets the 404 an unknown
 *   path gets. The user is ALWAYS the session's; a body user id is ignored. A visit that is not hers is dropped.
 *
 *   POST /api/portal/funnel/coach-trouble (text body, like the other funnel reports)
 *     { t: 'tap', screen, kind }   → app_funnel.trouble_tap
 *     { t: 'error', screen, kind } → app_funnel.page_error
 *   With the user and journey from the SESSION, only known values.
 */
const http = require('http');
const express = require('express');

const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const OTHER = '11111111-1111-4111-8111-111111111111';
const VISIT = '22222222-2222-4222-8222-222222222222';
const JOURNEY = 'j_0123456789abcdef';

let emitted; let redisStore; let redisUp; let coachApp; let visits;
beforeEach(() => {
  jest.resetModules();
  emitted = [];
  redisStore = new Map();
  redisUp = true;
  coachApp = true;
  visits = [{ id: VISIT, leader_user_id: USER }];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  jest.doMock('../../dashboard/lib/edge-redis', () => ({
    get: async (k) => (redisUp ? (redisStore.get(k) ?? null) : null),
    set: async (k, v, ttl) => { if (!redisUp) return false; redisStore.set(k, { v, ttl }); return true; },
  }));
  jest.doMock('../../dashboard/lib/portal-auth', () => ({
    requirePortalAuth: (req, res, next) => (req.session && req.session.portalUserId ? next() : res.status(401).json({ success: false })),
  }));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({ isCoachAppUser: async () => coachApp }));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: () => {
      const f = {};
      const chain = {
        select: () => chain,
        eq: (c, v) => { f[c] = v; return chain; },
        maybeSingle: async () => ({ data: visits.find((r) => r.id === f.id && r.leader_user_id === f.leader_user_id) || null, error: null }),
      };
      return chain;
    },
  }));
});
let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ session = { id: 'sess-1', portalUserId: USER, appJourney: { id: JOURNEY, at: Date.now(), feature: 'coach_observe' } } } = {}) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { if (session) req.session = { ...session }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/coach-handoff.routes'));
  a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').createAppFunnelRouter({}));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const post = (srv, path, body, { type = 'application/json' } = {}) => new Promise((resolve, reject) => {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'POST',
    headers: { 'Content-Type': type, 'Content-Length': Buffer.byteLength(data) } }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; });
    res.on('end', () => { let json = null; try { json = JSON.parse(out); } catch (_) { /* empty */ } resolve({ status: res.statusCode, json }); });
  });
  req.on('error', reject); req.write(data); req.end();
});
const handoff = (srv, body) => post(srv, '/api/portal/coach/handoff', body);
const trouble = (srv, body) => post(srv, '/api/portal/funnel/coach-trouble', body, { type: 'text/plain;charset=UTF-8' });

describe('POST /coach/handoff', () => {
  test('a code, stored 24 h with the session\'s coach, her visit, the screen and the journey', async () => {
    const res = await handoff(await app(), { screen: 'record', visitId: VISIT, userId: OTHER });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    const stored = redisStore.get(`coach_handoff:${res.json.code}`);
    expect(stored.ttl).toBe(24 * 60 * 60);
    const payload = JSON.parse(stored.v);
    expect(payload).toEqual(expect.objectContaining({ u: USER, v: VISIT, s: 'record', j: JOURNEY }));
    expect(JSON.stringify(payload)).not.toContain(OTHER);
  });

  test('the bot reads exactly what the portal writes (one shared definition)', async () => {
    const res = await handoff(await app(), { screen: 'visit', visitId: VISIT });
    const { handoffKey, isCode } = require('../../bot/shared/services/coach-handoff-code');
    expect(isCode(res.json.code)).toBe(true);
    expect(redisStore.has(handoffKey(res.json.code))).toBe(true);
  });

  test('a visit that is not hers, or not a uuid, is dropped (the code still goes: plain /observe on WhatsApp)', async () => {
    visits = [{ id: VISIT, leader_user_id: OTHER }];
    const srv = await app();
    const a = await handoff(srv, { screen: 'record', visitId: VISIT });
    expect(JSON.parse(redisStore.get(`coach_handoff:${a.json.code}`).v).v).toBeUndefined();
    const b = await handoff(srv, { screen: 'record', visitId: "x' or 1=1" });
    expect(JSON.parse(redisStore.get(`coach_handoff:${b.json.code}`).v).v).toBeUndefined();
  });

  test('an unknown screen is stored as "observe"', async () => {
    const res = await handoff(await app(), { screen: '<script>' });
    expect(JSON.parse(redisStore.get(`coach_handoff:${res.json.code}`).v).s).toBe('observe');
  });

  test('Redis not there: success with no code (the app opens the chat without one)', async () => {
    redisUp = false;
    const res = await handoff(await app(), { screen: 'record', visitId: VISIT });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true, code: null });
  });

  test('not a coach on the coach app: 404; signed out: 401', async () => {
    coachApp = false;
    expect((await handoff(await app(), { screen: 'record' })).status).toBe(404);
    expect((await handoff(await app({ session: null }), { screen: 'record' })).status).toBe(401);
    expect(redisStore.size).toBe(0);
  });

  test('logged: app_funnel.handoff_code with the journey and whether a code went', async () => {
    await handoff(await app(), { screen: 'check', visitId: VISIT });
    const row = emitted.find((x) => x.e === 'app_funnel.handoff_code');
    expect(row.d).toEqual(expect.objectContaining({ userId: USER, journeyId: JOURNEY, screen: 'check', visit: true, code: true }));
  });
});

describe('POST /funnel/coach-trouble', () => {
  test('a tap → app_funnel.trouble_tap, user and journey from the session', async () => {
    const res = await trouble(await app(), { t: 'tap', screen: 'attach', kind: 'upload', userId: OTHER });
    expect(res.status).toBe(204);
    const row = emitted.find((x) => x.e === 'app_funnel.trouble_tap');
    expect(row.d).toEqual(expect.objectContaining({ userId: USER, journeyId: JOURNEY, feature: 'observe', screen: 'attach', kind: 'upload' }));
    expect(JSON.stringify(row.d)).not.toContain(OTHER);
  });

  test('a failure → app_funnel.page_error {screen, kind}', async () => {
    await trouble(await app(), { t: 'error', screen: 'visit', kind: 'load' });
    expect(emitted.find((x) => x.e === 'app_funnel.page_error').d).toEqual(expect.objectContaining({ screen: 'visit', kind: 'load' }));
  });

  test('unknown values are made safe; a bad body is 400; signed out is 401', async () => {
    const srv = await app();
    await trouble(srv, { t: 'tap', screen: 'hack', kind: '<x>' });
    expect(emitted.find((x) => x.e === 'app_funnel.trouble_tap').d).toEqual(expect.objectContaining({ screen: 'unknown', kind: 'unknown' }));
    expect((await trouble(srv, { t: 'nope', screen: 'visit' })).status).toBe(400);
    expect((await trouble(srv, 'not json')).status).toBe(400);
    expect((await trouble(await app({ session: null }), { t: 'tap', screen: 'visit', kind: 'strip' })).status).toBe(401);
  });
});
