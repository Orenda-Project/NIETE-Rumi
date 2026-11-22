/**
 * bd-e0dqwz — the portal's sign-in endpoints are rate limited for real.
 *
 * They were not: publicAuthLimiter and tokenValidationLimiter were set to 10000 a minute ("TEMP: disabled") in
 * digital-coach-dashboard on 2025-11-13 to stop 429s while testing, and NIETE inherited them that way on 2026-01-27.
 * Production served every password guess. The limits below are sized from 10 weeks of production traffic
 * (06_Logs & Misc/Investigations/workspace/pk-ict/infra/bd-e0dqwz-portal-auth-rate-limit/).
 *
 * Loads the REAL portal router behind a real Express app with only its I/O edges stubbed (Supabase, bcrypt, the
 * WhatsApp code service), and the REAL express-rate-limit. The client IP comes from X-Forwarded-For through
 * `trust proxy` 1, as on Railway.
 */
const http = require('http');
const express = require('express');

const PHONE = '03001234567';
const user = { id: 'u-1', portal_password_hash: 'hash', portal_activated: true, name: 'Amina', role: 'teacher', deleted_at: null };

let passwordOk;
let codeService;

function stubEdges() {
  const chain = () => {
    const c = {};
    ['select', 'order', 'limit', 'insert', 'update', 'upsert', 'eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte'].forEach((m) => { c[m] = jest.fn(() => c); });
    c.maybeSingle = jest.fn(async () => ({ data: user, error: null }));
    c.single = c.maybeSingle;
    c.then = (ok, ko) => Promise.resolve({ data: [], error: null }).then(ok, ko);
    return c;
  };
  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn(() => chain()), rpc: jest.fn().mockResolvedValue({ error: null }) }));
  jest.doMock('../../dashboard/config/database', () => ({ query: jest.fn(async () => ({ rows: [] })), on: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn().mockResolvedValue([]), isValidR2Url: jest.fn(),
  }));
  jest.doMock('../../dashboard/feature-flags-stub', () => ({}), { virtual: true });
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  jest.doMock('pg', () => ({ Pool: jest.fn(() => ({ query: jest.fn(), on: jest.fn() })) }), { virtual: true });
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(async () => 'h'), compare: jest.fn(async () => passwordOk), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  codeService = {
    checkRateLimit: jest.fn(async () => ({ allowed: true })),
    sendResetCode: jest.fn(async () => ({ success: true })),
    verifyResetCode: jest.fn(async () => ({ valid: false })),
  };
  jest.doMock('../../dashboard/services/password-reset.service', () => codeService);
}

/** One portal process: the real router behind trust proxy 1, a JSON body parser and a session stub. */
function portalApp({ redis } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  if (redis !== undefined) require('../../dashboard/lib/edge-redis').setClient(redis);
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { regenerate: (cb) => cb() }; next(); });
  app.use('/api/portal', routes);
  return app;
}

const servers = [];
async function listen(app) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function post(base, path, body, ip) {
  const res = await fetch(`${base}/api/portal${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
  });
  return res.status;
}

async function postWith(base, path, body, headers) {
  const res = await fetch(`${base}/api/portal${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return res.status;
}

async function times(n, fn) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(await fn(i)); // eslint-disable-line no-await-in-loop
  return out;
}

/** A Redis that understands the two scripts lib/edge-redis sends, shared by every "process" handed it. */
function fakeRedis() {
  const counts = new Map();
  return {
    isReady: true,
    counts,
    async sendCommand(args) {
      const [cmd, script, , key, ms] = args;
      if (cmd !== 'EVAL') throw new Error(`unexpected ${cmd}`);
      const { HIT_SCRIPT, UNHIT_SCRIPT } = require('../../dashboard/lib/edge-redis');
      const now = Date.now();
      let c = counts.get(key);
      if (!c || c.until <= now) c = { n: 0, until: now + Number(ms) };
      if (script === HIT_SCRIPT) { c.n += 1; counts.set(key, c); return [c.n, c.until - now]; }
      if (script === UNHIT_SCRIPT) { c.n = Math.max(0, c.n - 1); counts.set(key, c); return c.n; }
      throw new Error('unknown script');
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  passwordOk = false;
  stubEdges();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  jest.resetModules();
});

describe('POST /api/portal/login', () => {
  it('refuses the 31st wrong password from one IP inside 15 minutes, and only that IP', async () => {
    const base = await listen(portalApp());
    // Thirty-one different accounts, so only the per-IP limit can be what refuses.
    const statuses = await times(31, (i) => post(base, '/login', { phoneNumber: `0300${String(1000000 + i)}`, password: 'wrong1234' }, '203.0.113.7'));
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect(await post(base, '/login', { phoneNumber: '03009999999', password: 'wrong1234' }, '203.0.113.8')).toBe(401);
  });

  it('refuses the 11th wrong password on one account even when every try comes from a new IP', async () => {
    const base = await listen(portalApp());
    const statuses = await times(11, (i) => post(base, '/login', { phoneNumber: PHONE, password: 'wrong1234' }, `198.51.100.${i + 1}`));
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    // The same account typed another way is the same account.
    expect(await post(base, '/login', { phoneNumber: '+92 300 1234567', password: 'wrong1234' }, '198.51.100.99')).toBe(429);
  });

  it('never refuses good sign-ins from one shared IP (a school on one Wi-Fi)', async () => {
    passwordOk = true;
    const base = await listen(portalApp());
    const statuses = await times(40, (i) => post(base, '/login', { phoneNumber: `0300${String(2000000 + i)}`, password: 'right1234' }, '203.0.113.20'));
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('shares one count across portal processes through Redis (the 4 cluster workers)', async () => {
    const redis = fakeRedis();
    let a; let b;
    jest.isolateModules(() => { stubEdges(); a = portalApp({ redis }); });
    jest.isolateModules(() => { stubEdges(); b = portalApp({ redis }); });
    const [baseA, baseB] = [await listen(a), await listen(b)];
    const statuses = await times(31, (i) => post(i % 2 ? baseB : baseA, '/login', { phoneNumber: `0301${String(1000000 + i)}`, password: 'wrong1234' }, '203.0.113.30'));
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect(redis.counts.size).toBeGreaterThan(0);
  });

  it('takes a good sign-in back off the shared count, so a shared IP never piles up', async () => {
    passwordOk = true;
    const redis = fakeRedis();
    const base = await listen(portalApp({ redis }));
    const statuses = await times(40, (i) => post(base, '/login', { phoneNumber: `0303${String(1000000 + i)}`, password: 'right1234' }, '203.0.113.31'));
    expect(statuses.every((s) => s === 200)).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect([...redis.counts.values()].every((c) => c.n === 0)).toBe(true);
  });
});

/**
 * On Railway req.ip is not the client. Under trust proxy 1 it is the Railway proxy hop in front of the portal: the
 * sandbox live check of 2026-11-05 saw 31 failures from one machine alternate between two keys, so the 31st was never
 * refused, and in production every teacher would share those few keys. Railway's HTTP edge sets X-Real-IP to the
 * connecting IP and replaces any value the caller sends, so on Railway that header is the client.
 */
describe('on Railway, the client is X-Real-IP', () => {
  const hop = (i) => `100.64.0.${(i % 2) + 1}`; // two proxy hops, taking turns, as the live check saw
  const wrong = (i, prefix = '0304') => ({ phoneNumber: `${prefix}${String(1000000 + i)}`, password: 'wrong1234' });

  beforeEach(() => { process.env.RAILWAY_ENVIRONMENT_ID = 'test-env'; });
  afterEach(() => { delete process.env.RAILWAY_ENVIRONMENT_ID; });

  it('counts one client as one, whichever proxy hop carries the request, and only that client', async () => {
    const base = await listen(portalApp());
    const statuses = await times(31, (i) => postWith(base, '/login', wrong(i), { 'x-real-ip': '203.0.113.60', 'x-forwarded-for': hop(i) }));
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect(await postWith(base, '/login', wrong(99, '0305'), { 'x-real-ip': '203.0.113.61', 'x-forwarded-for': hop(0) })).toBe(401);
  });

  it('counts one IPv6 /64 as one client, so rotating addresses inside it buys nothing', async () => {
    const base = await listen(portalApp());
    const statuses = await times(31, (i) => postWith(base, '/reset-password', { password: 'newpass123' }, { 'x-real-ip': `2001:db8:1:2::${(i + 1).toString(16)}`, 'x-forwarded-for': hop(i) }));
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect(await postWith(base, '/reset-password', { password: 'newpass123' }, { 'x-real-ip': '2001:db8:1:3::1', 'x-forwarded-for': hop(0) })).toBe(401);
  });

  it('off Railway a caller\'s own X-Real-IP is ignored, so it cannot buy a fresh count', async () => {
    delete process.env.RAILWAY_ENVIRONMENT_ID;
    const base = await listen(portalApp());
    const statuses = await times(31, (i) => postWith(base, '/login', wrong(i, '0306'), { 'x-real-ip': `198.51.100.${i + 1}`, 'x-forwarded-for': '203.0.113.62' }));
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe('the other public sign-in endpoints', () => {
  it('POST /reset-password: refuses the 31st failure from one IP inside 15 minutes', async () => {
    const base = await listen(portalApp());
    const statuses = await times(31, () => post(base, '/reset-password', { password: 'newpass123' }, '203.0.113.40'));
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it.each(['/request-code', '/request-reset'])('POST %s: refuses the 51st WhatsApp code from one IP inside an hour', async (path) => {
    const base = await listen(portalApp());
    const statuses = await times(51, (i) => post(base, path, { phoneNumber: `0302${String(1000000 + i)}` }, '203.0.113.50'));
    expect(statuses.slice(0, 50).every((s) => s === 200)).toBe(true);
    expect(statuses[50]).toBe(429);
    expect(codeService.sendResetCode).toHaveBeenCalledTimes(50);
  });
});
