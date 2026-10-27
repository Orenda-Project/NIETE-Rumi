/**
 * bd-nmwmr4.2 — a malformed JSON body is a 400 JSON, never a 500 with a template stack.
 *
 * express.json() throws `entity.parse.failed` before any router runs, so the dashboard's final
 * error handler answered every path. It rendered `error` without `isAuthenticated`, the view threw
 * a ReferenceError, and Express printed the template source and container path as a 500 to anyone
 * (red-3, sandbox d48feef862: 16 paths x 2 sessions, all 500 with a stack). The app below has the
 * same chain as dashboard/index.js: express.json(), the real hcp router, a portal route, then the
 * real final handler rendering the real views/error.ejs.
 */
const http = require('http');
const path = require('path');

const DASHBOARD = path.join(__dirname, '..', '..', 'dashboard');
// ejs is a dashboard dependency, not a root one, and CI installs only the root packages. The JSON
// cases never render; the view cases run wherever the dashboard's packages are installed.
let ejs = null;
try { ejs = require(require.resolve('ejs', { paths: [DASHBOARD] })); } catch (_e) { ejs = null; }
const withViews = ejs ? it : it.skip;

let server;
let baseUrl;

beforeEach(async () => {
  jest.resetModules();
  const { installSupabaseMock, resetTableStates } = require('./_shared');
  installSupabaseMock(resetTableStates());
  const express = require('express');
  const { finalErrorHandler } = require('../../dashboard/lib/final-error-handler');
  const app = express();
  if (ejs) app.engine('ejs', ejs.__express);
  app.set('view engine', 'ejs');
  app.set('views', path.join(DASHBOARD, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get('x-test-user');
    req.session = uid ? { portalUserId: uid, id: `sess-${uid}` } : {};
    next();
  });
  app.use('/api/portal/hcp', require('../../dashboard/routes/hcp.routes'));
  app.post('/api/portal/auth/login', (_req, res) => res.json({ success: true }));
  app.get('/boom', () => { throw new Error('kaput'); });
  app.use(finalErrorHandler);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function send(method, urlPath, { raw, user } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${urlPath}`, {
      method,
      agent: false,
      headers: {
        ...(user ? { 'x-test-user': user } : {}),
        ...(raw != null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (raw != null) req.write(raw);
    req.end();
  });
}

describe('malformed JSON body (bd-nmwmr4.2)', () => {
  it.each([
    ['POST', '/api/portal/hcp/generate-feedback', '{not json', null],
    ['POST', '/api/portal/hcp/generate-feedback', '{not json', 'coach-1'],
    ['POST', '/api/portal/hcp/schedules', '"x"', 'coach-1'],
    ['PATCH', '/api/portal/hcp/schedules/s-1', '{not json', null],
    ['POST', '/api/portal/auth/login', '{not json', null],
    ['POST', '/nope', '{not json', null],
  ])('%s %s with body %s (session %s) → 400 JSON, no-store, no stack', async (method, urlPath, raw, user) => {
    const res = await send(method, urlPath, { raw, user });
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(JSON.parse(res.body)).toEqual({ success: false, error: 'Malformed JSON body.' });
    expect(res.body).not.toMatch(/ejs|ReferenceError|views|at /);
  });

  withViews('a genuine server error still renders the error page (500), not a template stack', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await send('GET', '/boom');
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toMatch(/Server Error - NIETE Observability Portal/);
    expect(res.body).toMatch(/Go to Login/);
    expect(res.body).not.toMatch(/ReferenceError|error\.ejs|kaput/);
  });
});

describe('views/error.ejs (bd-nmwmr4.2)', () => {
  const view = path.join(DASHBOARD, 'views', 'error.ejs');

  withViews('renders without isAuthenticated (the 404 and older 500 renders never pass it)', async () => {
    const html = await ejs.renderFile(view, { title: 'Server Error', message: 'm', error: 'e' });
    expect(html).toMatch(/Go to Login/);
  });

  withViews('renders with no locals at all', async () => {
    const html = await ejs.renderFile(view, {});
    expect(html).toMatch(/NIETE Observability Portal/);
  });

  withViews('still shows the dashboard link to a signed-in viewer', async () => {
    const html = await ejs.renderFile(view, { title: 't', message: 'm', error: 'e', isAuthenticated: true });
    expect(html).toMatch(/Back to Dashboard/);
  });
});

describe('dashboard/index.js wiring (bd-nmwmr4.2)', () => {
  const src = require('fs').readFileSync(path.join(DASHBOARD, 'index.js'), 'utf8');

  it('the last error handler is finalErrorHandler, mounted after every route', () => {
    const mount = src.lastIndexOf('app.use(finalErrorHandler)');
    expect(mount).toBeGreaterThan(-1);
    expect(src.indexOf('app.listen(')).toBeGreaterThan(mount);
    expect(src.slice(mount)).not.toMatch(/app\.(use|get|post|put|patch|delete)\(\s*['"/]/);
    expect(src).not.toMatch(/app\.use\(\(err, req, res, next\)/);
  });
});
