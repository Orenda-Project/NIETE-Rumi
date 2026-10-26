'use strict';
/**
 * bd-sex15q.13 — the COACHIP mount in dashboard/index.js, EXECUTED (root rule 6: the red test runs the changed line,
 * not a grep of it). The block between the "bd-sex15q.13 — COACHIP" comment and its closing brace is cut from
 * index.js and run with index.js's own require (module.createRequire) against a recording `app`, a fake pool and a
 * fake supabase: it must mount one router at /api/portal behind cors + the two limiters, wire m-player's media module
 * only when that file exists, and rethrow any other load error (never swallow a broken module).
 *
 * And B7 at the mount level: the router answers /coachip/* only. Every other /api/portal request passes through it
 * untouched (no header set, next() called), so the existing portal routes behind it cannot change.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { ROOT } = require('./helpers/pg-harness');

// COACHIP_MOUNT_INDEX: run against another copy of index.js in dashboard/ (the red run uses the base commit's).
const INDEX = path.join(ROOT, 'dashboard', process.env.COACHIP_MOUNT_INDEX || 'index.js');
const express = require(path.join(ROOT, 'dashboard', 'node_modules', 'express'));
const http = require('http');

function mountBlock() {
  const src = fs.readFileSync(INDEX, 'utf8');
  const at = src.indexOf('// bd-sex15q.13 — COACHIP');
  if (at < 0) throw new Error('no COACHIP mount in dashboard/index.js');
  const open = src.indexOf('\n{\n', at);
  let depth = 0; let i = open + 1;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return src.slice(open + 1, i + 1);
}

/** Run the block with index.js's require, overriding a few module ids. */
function runBlock({ media } = {}) {
  const realRequire = Module.createRequire(INDEX);
  const pool = { query: jest.fn(async () => ({ rows: [] })) };
  const fakeRequire = (id) => {
    if (id === './config/database') return pool;
    if (id === './routes/portal-coachip-media.routes') {
      if (media === undefined) {
        const e = new Error("Cannot find module './routes/portal-coachip-media.routes'");
        e.code = 'MODULE_NOT_FOUND';
        throw e;
      }
      if (media instanceof Error) throw media;
      return media;
    }
    return realRequire(id);
  };
  const uses = [];
  const app = { use: (...args) => uses.push(args) };
  const marks = { cors: () => 'cors-mw', limiterA: 'auth-limiter', limiterB: 'data-limiter' };
  // eslint-disable-next-line no-new-func
  const fn = new Function('app', 'cors', 'portalCorsOptions', 'portalAuthLimiter', 'portalDataLimiter', 'supabase', 'require', mountBlock());
  fn(app, marks.cors, {}, marks.limiterA, marks.limiterB, { from: () => { throw new Error('no db in this test'); } }, fakeRequire);
  return { uses, pool };
}

const routePaths = (router) => router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);

describe('dashboard/index.js COACHIP mount (executed)', () => {
  const saved = process.env.COACHIP_TEACHER_KEY_SECRET;
  beforeAll(() => { process.env.COACHIP_TEACHER_KEY_SECRET = 'mount-test-secret-0123456789abcdef0123456789'; });
  afterAll(() => { if (saved === undefined) delete process.env.COACHIP_TEACHER_KEY_SECRET; else process.env.COACHIP_TEACHER_KEY_SECRET = saved; });

  test('one router at /api/portal behind cors and the two limiters, carrying every COACHIP route', () => {
    const { uses } = runBlock();
    expect(uses).toHaveLength(1);
    const [mountPath, corsMw, a, b, router] = uses[0];
    expect([mountPath, corsMw, a, b]).toEqual(['/api/portal', 'cors-mw', 'auth-limiter', 'data-limiter']);
    const paths = routePaths(router);
    for (const p of ['GET /coachip/me', 'GET /coachip/home', 'GET /coachip/w/:wId', 'POST /coachip/steps', 'GET /coachip/rm/home',
      'POST /coachip/rm/notes', 'GET /coachip/m/:momentId/clip', 'GET /coachip/session/:sessionId/audio']) {
      expect(paths).toContain(p);
    }
  });

  test('m-player\'s module, when present, is wired with scope.inScope, scope.circleAllows and codes.audit', () => {
    const seen = [];
    const media = {
      createCoachipMediaRoutes: (deps) => { seen.push(deps); return (router, guards) => { router.get('/coachip/m/:momentId/clip', ...guards.either, (_q, r) => r.end('media')); }; },
    };
    const { uses } = runBlock({ media });
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0]).sort()).toEqual(['audit', 'circleAllows', 'inScope', 'query']);
    for (const k of Object.keys(seen[0])) expect(typeof seen[0][k]).toBe('function');
    const clipRoutes = routePaths(uses[0][4]).filter((p) => p === 'GET /coachip/m/:momentId/clip');
    expect(clipRoutes).toHaveLength(1);   // m-player's, not the placeholder
  });

  test('a media module that fails for another reason is not swallowed', () => {
    const broken = new Error("Cannot find module 'fluent-ffmpeg'");
    broken.code = 'MODULE_NOT_FOUND';
    expect(() => runBlock({ media: broken })).toThrow(/fluent-ffmpeg/);
    expect(() => runBlock({ media: new SyntaxError('Unexpected token') })).toThrow(/Unexpected token/);
  });
});

describe('B7 at the mount: non-COACHIP requests pass through untouched', () => {
  let srv;
  beforeAll(async () => {
    process.env.COACHIP_TEACHER_KEY_SECRET = 'mount-test-secret-0123456789abcdef0123456789';
    const { uses } = runBlock();
    const app = express();
    app.use((req, _res, next) => { req.session = { portalUserId: '00000000-0000-4000-8000-070000000001' }; next(); });
    app.use('/api/portal', uses[0][4]);
    app.use('/api/portal', (req, res) => res.status(299).json({ reached: req.method + ' ' + req.path, cc: res.get('Cache-Control') || null }));
    srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  });
  afterAll(() => new Promise((r) => srv.close(r)));
  const get = (p, method = 'GET') => new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(t) }));
    });
    q.on('error', reject); q.end();
  });

  test.each([
    '/api/portal/coach/home', '/api/portal/config', '/api/portal/leader/me', '/api/portal/fln/me', '/api/portal/hcp/teachers',
    '/api/portal/coachipx', '/api/portal/coach/disagreements', '/api/portal/leader/child-test/visits', '/api/portal/analytics/schools',
  ])('%s reaches the next router with no COACHIP header', async (p) => {
    const r = await get(p);
    expect(r.status).toBe(299);
    expect(r.body).toEqual({ reached: `GET ${p.replace('/api/portal', '')}`, cc: null });
  });
  test('POST /api/portal/fln/send passes through too', async () => {
    expect((await get('/api/portal/fln/send', 'POST')).status).toBe(299);
  });
});
