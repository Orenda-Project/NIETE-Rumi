/**
 * Jest must never reach a live service.
 *
 * A developer's worktree usually carries a real .env, and shared/config/supabase.js builds a
 * service-role client from it at require time; many test files reach that client (or Redis, an LLM
 * SDK, WhatsApp) through helpers without mocking it. tests/setup-loopback.js (jest.config.js
 * `setupFiles`) loopbacks every service endpoint, dummies every credential, makes the database and
 * Supabase constructors refuse a non-loopback host, and refuses any non-loopback socket, before a
 * test module loads.
 *
 * Without the guard these fail, e.g.:
 *   SUPABASE_URL=https://example.supabase.co npx jest tests/setup-loopback.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const LOOPBACK = /^(https?|redis|postgres):\/\/([^@/]*@)?127\.0\.0\.1:9(\/|$)/;
const live = process.env.ALLOW_LIVE_SERVICES_IN_TESTS === '1';
const maybe = live ? test.skip : test;
// This bot does not depend on `pg`; the guard wraps it only when it is installed.
const hasPg = (() => { try { require.resolve('pg'); return true; } catch { return false; } })();

function request(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 5000 }, (res) => { res.resume(); resolve({ status: res.statusCode }); });
    req.on('error', (err) => resolve({ code: err.egressBlocked ? 'EGRESS_BLOCKED' : err.code }));
    req.on('timeout', () => { req.destroy(); resolve({ code: 'TIMEOUT' }); });
  });
}

describe('jest never reaches a live service', () => {
  maybe('the Supabase client every unmocked test loads points at loopback', () => {
    jest.isolateModules(() => {
      const supabase = require('../shared/config/supabase');
      expect(String(supabase.supabaseUrl)).toMatch(LOOPBACK);
    });
  });

  maybe.each([
    'SUPABASE_URL', 'REDIS_URL', 'SQS_QUEUE_URL', 'SQS_DLQ_URL', 'SQS_VIDEO_QUEUE_URL',
    'R2_ENDPOINT', 'DATABASE_URL', 'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'OPENROUTER_BASE_URL',
  ])('%s is a loopback endpoint', (key) => {
    expect(process.env[key]).toMatch(LOOPBACK);
  });

  maybe.each([
    'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'WHATSAPP_TOKEN', 'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY', 'ANTHROPIC_DIRECT_API_KEY', 'OPENROUTER_API_KEY',
  ])('%s is the test dummy, not a real credential', (key) => {
    expect(process.env[key]).toBe('test-loopback');
  });

  maybe('a hard-coded host (WhatsApp Graph API) is refused before it leaves the machine', async () => {
    await expect(request('https://graph.facebook.com/v21.0/0/messages')).resolves.toEqual({ code: 'EGRESS_BLOCKED' });
  });

  maybe('fetch to a hard-coded LLM host (OpenRouter) is refused', async () => {
    const err = await fetch('https://openrouter.ai/api/v1/models').then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect((err.cause || err).egressBlocked).toBe(true);
    expect((err.cause || err).code).toBe('ENOTFOUND'); // what a dead network gives for a name
  });

  // 198.51.100.1 is TEST-NET-2: never routable, so a missed guard shows as a timeout, not a reply.
  const TARGET = { host: '198.51.100.1', port: 443 };
  const outcome = (start) => new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish('TIMEOUT'), 1500);
    try {
      start((err) => { clearTimeout(timer); finish(err ? (err.egressBlocked ? 'EGRESS_BLOCKED' : err.code || String(err)) : 'CONNECTED'); });
    } catch (err) {
      clearTimeout(timer); finish(err.code || String(err));
    }
  });

  maybe.each([
    ['net.Socket#connect', (cb) => new (require('net').Socket)().on('error', cb).connect(TARGET)],
    ['net.connect', (cb) => require('net').connect(TARGET).on('error', cb).on('connect', () => cb())],
    ['net.createConnection', (cb) => require('net').createConnection(TARGET).on('error', cb).on('connect', () => cb())],
    ['tls.connect', (cb) => require('tls').connect({ ...TARGET, servername: 'x' }).on('error', cb).on('secureConnect', () => cb())],
    ['http.request', (cb) => require('http').request({ ...TARGET, port: 80 }).on('error', cb).end()],
    ['https.request', (cb) => require('https').request(TARGET).on('error', cb).end()],
    ['fetch', (cb) => fetch(`https://${TARGET.host}/`).then(() => cb(), (e) => cb(e.cause || e))],
  ])('%s to a non-loopback host fails with EGRESS_BLOCKED at once', async (_name, start) => {
    await expect(outcome(start)).resolves.toBe('EGRESS_BLOCKED');
  });

  (hasPg ? maybe : test.skip)('a Postgres pool hard-coded to a production pooler throws when it is built', () => {
    const { Pool, Client } = require('pg');
    expect(() => new Pool({ host: 'aws-0-example-1.pooler.supabase.com', port: 6543 })).toThrow(/EGRESS_BLOCKED/);
    expect(() => new Client('postgresql://u:p@db.example.supabase.co:5432/postgres')).toThrow(/EGRESS_BLOCKED/);
    const local = new Pool({ host: '127.0.0.1', port: 9 });
    expect(local).toBeDefined();
    return local.end();
  });

  maybe('a Supabase client built for a real project URL throws', () => {
    const { createClient } = require('@supabase/supabase-js');
    expect(() => createClient('https://abcdefgh.supabase.co', 'k')).toThrow(/EGRESS_BLOCKED/);
    expect(createClient('http://127.0.0.1:9', 'k')).toBeDefined();
  });

  maybe('a client for a reserved test host (RFC 2606) can be built; connecting to it still fails offline', async () => {
    const { createClient } = require('@supabase/supabase-js');
    expect(createClient('http://db.test', 'k')).toBeDefined();
    expect(createClient('https://acct.r2.example.com', 'k')).toBeDefined();
    await expect(request('https://acct.r2.example.com/x')).resolves.toEqual({ code: 'EGRESS_BLOCKED' });
  });

  maybe('a refused connection looks like a dead network to the caller (ENOTFOUND / ECONNREFUSED)', async () => {
    const codeOf = (opts) => new Promise((resolve) => {
      require('net').connect(opts).on('error', (e) => resolve([e.code, e.egressBlocked, /^EGRESS_BLOCKED/.test(e.message)]));
    });
    await expect(codeOf({ host: 'api.vendor.example.org', port: 443 })).resolves.toEqual(['ENOTFOUND', true, true]);
    await expect(codeOf({ host: '198.51.100.1', port: 443 })).resolves.toEqual(['ECONNREFUSED', true, true]);
  });

  maybe('a production-shaped .env is neutralised before dotenv can load it', () => {
    const { applyLoopbackEnv } = require('./setup-loopback');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-'));
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, [
      'SUPABASE_URL=https://abcdefgh.supabase.co',
      'SUPABASE_SERVICE_ROLE_KEY=eyJproductionshaped',
      'SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/example-queue.fifo',
      'KIE_API_KEY=real-looking-key',
      'NEW_VENDOR_ENDPOINT=https://api.vendor.example/v2',
      'AXIOM_TOKEN=xaat-real-looking',
      'PUBLIC_SITE_BASE_URL=https://example.org',
      'DEFAULT_REGION=pakistan',
    ].join('\n'));
    const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SQS_QUEUE_URL', 'KIE_API_KEY',
      'NEW_VENDOR_ENDPOINT', 'AXIOM_TOKEN', 'PUBLIC_SITE_BASE_URL', 'DEFAULT_REGION'];
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    try {
      for (const n of names) delete process.env[n];
      applyLoopbackEnv(file);
      require('dotenv').config({ path: file });
      expect(process.env.SUPABASE_URL).toMatch(LOOPBACK);
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe('test-loopback');
      expect(process.env.SQS_QUEUE_URL).toBe('http://127.0.0.1:9/123456789012/example-queue.fifo');
      expect(process.env.KIE_API_KEY).toBe('test-loopback');
      expect(process.env.NEW_VENDOR_ENDPOINT).toBe('http://127.0.0.1:9/v2');
      expect(process.env.AXIOM_TOKEN).toBe('');
      expect(process.env.PUBLIC_SITE_BASE_URL).toBe('https://example.org'); // a link base, not a service
      expect(process.env.DEFAULT_REGION).toBe('pakistan');
    } finally {
      for (const n of names) {
        if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n];
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('loopback connections still work (supertest, local servers)', async () => {
    const http = require('http');
    const server = http.createServer((req, res) => res.end('ok'));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/`, (res) => {
        let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(b));
      }).on('error', reject);
    });
    server.close();
    expect(body).toBe('ok');
  });

  test('jest.config.js loads the guard before every test file', () => {
    const config = require('../jest.config');
    expect(config.setupFiles).toContain('<rootDir>/tests/setup-loopback.js');
  });

  test('ALLOW_LIVE_SERVICES_IN_TESTS=1 leaves the environment alone', () => {
    const saved = { ...process.env };
    try {
      process.env.ALLOW_LIVE_SERVICES_IN_TESTS = '1';
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      jest.isolateModules(() => require(path.join(__dirname, 'setup-loopback.js')));
      expect(process.env.SUPABASE_URL).toBe('https://example.supabase.co');
    } finally {
      process.env = saved;
    }
  });
});
