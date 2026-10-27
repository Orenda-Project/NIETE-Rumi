'use strict';
/**
 * bd-sex15q.13 (worker w-write) — B7: the golden route-shape snapshots of the EXISTING portal routes, taken with NO
 * COACHIP row in app_settings (contracts/API.md v1.4 §13, design/SPEC.md v2 §6 routes half).
 *
 * What it does. It builds an express app the way dashboard/index.js mounts the portal (a session, express.json, then
 * the real routers at the real prefixes: portal.routes.js at /api/portal — which carries the coach-disagreements
 * router — portal-child-test.routes.js at /api/portal/leader/child-test, and portal-fln.routes.js at /api/portal —
 * which carries the FLN links and send routers), calls every route in API §13's table over HTTP as a fictional coach,
 * and records each answer's SHAPE (status, then keys and JSON value types; never values) in
 * tests/coachip/__golden__/routes.golden.json.
 *
 *   - The first run, when the golden file does not exist, writes it and passes. Every later run compares and fails on
 *     any difference. `UPDATE_GOLDEN=1` rewrites it. The m-api manager runs it once before and once after the
 *     COACHIP mount line lands in dashboard/index.js (B7: any diff fails).
 *   - The same calls run a second time with the COACHIP router (createCoachipRouter, every switch off) mounted AHEAD of
 *     the portal routers at /api/portal, the most intrusive order index.js could use; the shapes must equal the
 *     golden. This checks the mount itself here, independent of index.js.
 *   - GET /config's snapshot already carries features.coachip / coachipRm / coachipDecode (all false, booleans):
 *     the m-api manager added them to portal.routes.js before this snapshot was first taken (API §5, §13 "this
 *     snapshot changes once, deliberately, in the same PR").
 *
 * The boundary is mocked, nothing else: dashboard/config/supabase answers every read with no rows (the users read
 * for the session user answers one fictional coach row, so the leader gate passes), dashboard/config/database answers
 * every query with no rows. No network (bot/tests/setup-loopback.js), no model call, no real data.
 *
 * Not reachable this way (listed in NOT_REACHED, no snapshot): GET /health (dashboard/index.js:3756 — loading index.js
 * starts the whole server and its workers). The disagreements clip route answers its flag-off 404 before any ffmpeg
 * step, so its snapshot is a status + body shape like the rest.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');

// ── the boundary (jest.mock factories may only touch `mock*` names) ─────────────────────────────────────────────
const mockCoachId = '00000000-0000-4000-8000-070000000101';   // a fictional coach (FIXTURES id scheme)
function mockBuilder(table) {
  const filters = {};
  let proxy = null;
  const list = () => ({ data: [], error: null, count: 0, status: 200, statusText: 'OK' });
  const one = () => ({
    data: table === 'users' && filters.id === mockCoachId
      ? { id: mockCoachId, role: 'coach', name: null, phone_number: 'fixture-golden', school_id: null, preferred_language: 'en', country: null, deleted_at: null }
      : null,
    error: null,
    status: 200,
  });
  proxy = new Proxy(function builder() {}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') return (ok, bad) => Promise.resolve(list()).then(ok, bad);
      if (prop === 'catch') return (bad) => Promise.resolve(list()).catch(bad);
      if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(one());
      if (prop === 'eq') return (col, val) => { filters[col] = val; return proxy; };
      return () => proxy;
    },
  });
  return proxy;
}
jest.mock('../../dashboard/config/supabase', () => ({
  from: (t) => mockBuilder(t),
  rpc: () => mockBuilder('rpc'),
  schema: () => ({ from: (t) => mockBuilder(t), rpc: () => mockBuilder('rpc') }),
  storage: { from: () => mockBuilder('storage') },
}));
jest.mock('../../dashboard/config/database', () => {
  const empty = async () => ({ rows: [], rowCount: 0 });
  return { query: empty, connect: async () => ({ query: empty, release: () => {} }), on: () => {}, end: async () => {} };
});

const GOLDEN = path.join(__dirname, '__golden__', 'routes.golden.json');
const UUID = '00000000-0000-4000-8000-0f0000000201';   // an invented id for every :id
const PLAN_KEY = 'abcdef0123456789';                   // a fictional teacher key (16 hex) for POST /fln/send

/** API §13's table. [method, path, body?] under /api/portal. */
const ROUTES = [
  // Coach v2 (portal.routes.js)
  ['GET', '/coach/home'], ['GET', '/coach/pending'], ['GET', '/coach/schedule'], ['GET', '/coach/team'], ['GET', '/coach/people'],
  ['GET', '/coach/school/110'], ['GET', '/coach/teacher/fx-teacher-01'], ['GET', `/coach/observation/${UUID}`],
  ['GET', `/coach/visit/${UUID}`], ['GET', '/coach/reports'],
  // Disagreements (coach-disagreements.routes.js, mounted inside portal.routes.js)
  ['GET', '/coach/disagreements'], ['GET', `/coach/disagreements/${UUID}`], ['GET', `/coach/disagreements/${UUID}/clip`],
  ['POST', `/coach/disagreements/${UUID}/visited`, {}], ['POST', `/coach/disagreements/${UUID}/undone`, {}],
  ['POST', `/coach/disagreements/${UUID}/plan`, {}], ['POST', `/coach/disagreements/${UUID}/suggestion`, {}],
  // Leader (portal.routes.js)
  ['GET', '/leader/me'], ['GET', '/leader/overview'], ['GET', '/leader/teachers'], ['GET', `/leader/teacher/${UUID}`],
  ['GET', '/leader/attendance'], ['GET', '/leader/school-analytics'], ['GET', '/leader/observations'],
  ['GET', '/leader/schools/search?q=Fictional'], ['GET', '/leader/teachers/search?q=Fictional'],
  ['GET', '/leader/observe/recent-plans'], ['GET', '/leader/observe/active'], ['GET', `/leader/observe/${UUID}`],
  ['GET', `/leader/observe/${UUID}/draft`],
  // Child test (portal-child-test.routes.js at /api/portal/leader/child-test)
  ['GET', '/leader/child-test/visits'], ['GET', '/leader/child-test/list'], ['GET', `/leader/child-test/session/${UUID}`],
  ['GET', '/leader/child-test/sa/switches'], ['GET', '/leader/child-test/sa/schools'], ['GET', '/leader/child-test/sa/list'],
  ['GET', '/leader/child-test/sa/sessions'],
  // FLN (portal-fln.routes.js; /fln/teachers and /fln/send from portal-fln-send.routes.js through portal-fln-links)
  ['GET', '/fln/me'], ['GET', '/fln/catalogue?grade=1&subject=num'], ['GET', '/fln/teachers'],
  ['POST', '/fln/send', { plan: '101', teachers: [PLAN_KEY] }],
  // Analytics (portal.routes.js)
  ['GET', '/analytics/schools'], ['GET', '/analytics/coaching'], ['GET', '/analytics/training-levels'],
  ['GET', '/analytics/observations'], ['GET', '/analytics/lp-engagement'],
  // Config (portal.routes.js): carries features.coachip / coachipRm / coachipDecode, all false
  ['GET', '/config'],
];
const NOT_REACHED = { 'GET /health': 'dashboard/index.js:3756 — needs the whole server (index.js) loaded' };

/** Keys and JSON types, never values; an array's shape is its first element's (or [] when empty). */
function shapeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0])] : [];
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = shapeOf(v[k]);
    return out;
  }
  return typeof v;
}

function call(srv, method, url, body) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = data === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) };
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: `/api/portal${url}`, method, headers }, (res) => {
      let raw = ''; res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed; let kind = 'json';
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { parsed = null; kind = 'text'; }
        resolve({ status: res.statusCode, body: kind === 'json' ? shapeOf(parsed) : 'text' });
      });
    });
    r.setTimeout(15000, () => { r.destroy(); resolve({ status: 'timeout', body: null }); });
    r.on('error', () => resolve({ status: 'error', body: null }));
    if (data !== null) r.write(data);
    r.end();
  });
}

/** The app as index.js mounts these routers; `coachip` puts the COACHIP router (every switch off) ahead of them all. */
function buildApp({ coachip = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { portalUserId: mockCoachId, save: (cb) => cb && cb(), destroy: (cb) => cb && cb() }; next(); });
  if (coachip) {
    const { createCoachipRouter } = require('../../dashboard/routes/portal-coachip.routes');
    const off = async () => false;
    app.use('/api/portal', createCoachipRouter({
      query: async () => ({ rows: [] }),
      tx: async (fn) => fn(async () => ({ rows: [] })),
      flags: { coachOn: off, rmSector: async () => null, decodeOn: off },
      scope: { coachScope: async () => null, rmScope: async () => null, inScope: off, circleAllows: off },
      codes: { ready: () => true, teacherKey: () => null, codeFor: off, codesFor: off, keyFor: async () => null, audit: off },
    }));
  }
  app.use('/api/portal', require('../../dashboard/routes/portal.routes'));
  app.use('/api/portal/leader/child-test', require('../../dashboard/routes/portal-child-test.routes'));
  app.use('/api/portal', require('../../dashboard/routes/portal-fln.routes'));
  return app;
}

async function snapshot(app) {
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const out = {};
  const quiet = ['log', 'warn', 'error', 'info'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
  try {
    for (const [method, url, body] of ROUTES) {
      // eslint-disable-next-line no-await-in-loop
      out[`${method} ${url.replace(UUID, ':id')}`] = await call(srv, method, url, body);
    }
  } finally {
    quiet.forEach((s) => s.mockRestore());
    await new Promise((r) => srv.close(r));
  }
  return out;
}

describe('B7 golden route shapes, no COACHIP row in app_settings (API §13)', () => {
  const saved = {};
  let current;
  beforeAll(async () => {
    // A bot number in the shell would change GET /config's `bot` from null to a string: pin it to none.
    for (const k of ['WHATSAPP_BOT_NUMBER', 'REFERRAL_BOT_NUMBER', 'MAIN_BOT_URL']) { saved[k] = process.env[k]; delete process.env[k]; }
    current = await snapshot(buildApp());
  }, 120000);
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  });

  test('every route answered (no timeout, no socket error)', () => {
    const broken = Object.entries(current).filter(([, r]) => typeof r.status !== 'number').map(([k]) => k);
    expect(broken).toEqual([]);
    expect(Object.keys(current)).toHaveLength(ROUTES.length);
  });

  test('GET /config carries coachip, coachipRm, coachipDecode as booleans (all false with no row)', () => {
    const f = current['GET /config'].body.features;
    expect(f).toMatchObject({ coachip: 'boolean', coachipRm: 'boolean', coachipDecode: 'boolean' });
  });

  test('the shapes equal tests/coachip/__golden__/routes.golden.json (written on the first run; UPDATE_GOLDEN=1 rewrites)', () => {
    const file = { _about: 'B7 golden route shapes (API.md §13): status + keys/JSON types, never values. No COACHIP app_settings row. '
      + 'GET /config already includes features.coachip/coachipRm/coachipDecode (false). Regenerate: UPDATE_GOLDEN=1.',
    not_reached: NOT_REACHED,
    routes: current };
    if (process.env.UPDATE_GOLDEN === '1' || !fs.existsSync(GOLDEN)) {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, `${JSON.stringify(file, null, 2)}\n`);
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(current).toEqual(golden.routes);
    expect(golden.not_reached).toEqual(NOT_REACHED);
  });

  test('with the COACHIP router mounted ahead of them (every switch off), every existing route answers the same shape', async () => {
    const withCoachip = await snapshot(buildApp({ coachip: true }));
    expect(withCoachip).toEqual(current);
  }, 120000);
});
