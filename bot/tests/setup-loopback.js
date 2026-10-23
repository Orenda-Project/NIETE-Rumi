/**
 * Loaded by jest.config.js `setupFiles`, before every test file and therefore before any module
 * calls `require('dotenv').config()` (dotenv never overrides a variable that is already set).
 *
 * A developer's worktree usually carries a real .env, so an unmocked client in a test would be a
 * live client. Three layers:
 *
 *  1. Environment. Every service-endpoint variable (…_HOST, …_ENDPOINT, …_DSN, …_QUEUE_URL,
 *     …_API_URL, SUPABASE/REDIS/DATABASE_URL, the LLM SDK base URLs) found in the shell or in .env
 *     points at a dead loopback port, keeping its scheme and path; every credential-shaped one
 *     (…_KEY, …_TOKEN, …_SECRET, …_PASSWORD, …_PIN) becomes a dummy; log-shipping tokens are emptied.
 *     Public link bases and every other variable are left for dotenv as before.
 *  2. Construction. `pg.Pool` / `pg.Client` (when installed) and supabase-js `createClient` throw
 *     EGRESS_BLOCKED when built for a real host. Loopback and the reserved test names of RFC 2606 /
 *     6761 (`*.test`, `*.example`, `*.invalid`, `*.localhost`, `example.com|net|org`) are allowed:
 *     they cannot be a live service, and many tests build a client for them with fetch mocked.
 *  3. Egress. Any socket connect to a host that is not loopback fails exactly as a dead network
 *     would: `ENOTFOUND` for a name, `ECONNREFUSED` for an address (so retry and fallback logic takes
 *     the path it takes offline), with `err.egressBlocked = true` and an `EGRESS_BLOCKED: …` message.
 *     This also covers hard-coded hosts and clients built in a fresh module registry.
 *
 * Opt out deliberately, for one run: ALLOW_LIVE_SERVICES_IN_TESTS=1. See tests/setup-loopback.test.js.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');

const DUMMY = 'test-loopback';
const ENDPOINT = /_(HOST|ENDPOINT|DSN|QUEUE_URL|API_URL|SERVICE_URL|DATABASE_URL)$|^(SUPABASE|REDIS|DATABASE)_URL$/;
const CREDENTIAL = /_(KEY|TOKEN|SECRET|PASSWORD|PIN|KEY_B64)$|^(OPENAI|ANTHROPIC|OPENROUTER)_.*KEY/;
const EMPTIED = ['AXIOM_TOKEN', 'AXIOM_API_TOKEN', 'AXIOM_DATASET'];
// Endpoints that some clients read even when .env does not name them.
const ALWAYS_ENDPOINTS = [
  'SUPABASE_URL', 'REDIS_URL', 'SQS_QUEUE_URL', 'SQS_DLQ_URL', 'SQS_VIDEO_QUEUE_URL', 'R2_ENDPOINT',
  'DATABASE_URL', 'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'OPENROUTER_BASE_URL',
];
const ALWAYS_CREDENTIALS = [
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'WHATSAPP_TOKEN', 'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_DIRECT_API_KEY', 'OPENROUTER_API_KEY',
];

function loopbackFor(value) {
  const v = String(value || '');
  if (/^rediss?:\/\//.test(v)) return 'redis://127.0.0.1:9';
  if (/^postgres(ql)?:\/\//.test(v)) return 'postgres://test:test@127.0.0.1:9/test';
  let pathname = '';
  try { pathname = new URL(v).pathname.replace(/\/$/, ''); } catch { /* not a URL: no path to keep */ }
  return `http://127.0.0.1:9${pathname}`;
}

function readDotenvNames(file) {
  try {
    return Object.keys(require('dotenv').parse(fs.readFileSync(file)));
  } catch {
    return [];
  }
}

function applyLoopbackEnv(envFile = process.env.DOTENV_CONFIG_PATH || path.join(__dirname, '..', '.env')) {
  const fileValues = (() => {
    try { return require('dotenv').parse(fs.readFileSync(envFile)); } catch { return {}; }
  })();
  const names = new Set([...readDotenvNames(envFile), ...Object.keys(process.env), ...ALWAYS_ENDPOINTS,
    ...ALWAYS_CREDENTIALS]);
  for (const name of names) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    if (EMPTIED.includes(name)) process.env[name] = '';
    else if (CREDENTIAL.test(name) || ALWAYS_CREDENTIALS.includes(name)) process.env[name] = DUMMY;
    else if (ENDPOINT.test(name) || ALWAYS_ENDPOINTS.includes(name)) {
      process.env[name] = loopbackFor(process.env[name] || fileValues[name]);
    }
  }
  for (const name of EMPTIED) process.env[name] = '';
  delete process.env.SUPABASE_DB_PASSWORD;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '']);

function isLoopbackHost(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.has(h) || h.startsWith('127.');
}

const RESERVED_TEST_HOST = /(^|\.)(test|example|invalid|localhost)$|(^|\.)example\.(com|net|org)$/i;

function isConstructAllowed(host) {
  return isLoopbackHost(host) || RESERVED_TEST_HOST.test(String(host || ''));
}

function blocked(what) {
  const err = new Error(`EGRESS_BLOCKED: a test tried to build ${what} (tests/setup-loopback.js)`);
  err.code = 'EGRESS_BLOCKED';
  return err;
}

function hostOfUrl(url) {
  try { return new URL(String(url)).hostname; } catch { return null; }
}

function installConstructorGuards() {
  let pg = null;
  try { pg = require('pg'); } catch { /* not installed */ }
  if (pg && !pg.__loopbackGuard) {
    const check = (cfg) => {
      const c = typeof cfg === 'string' ? { connectionString: cfg } : (cfg || {});
      const host = c.connectionString ? hostOfUrl(c.connectionString) : (c.host || process.env.PGHOST || '');
      if (!isConstructAllowed(host)) throw blocked(`a Postgres client for ${host}`);
    };
    const wrap = (Base) => class extends Base {
      constructor(cfg) { check(cfg); super(cfg); }
    };
    pg.Pool = wrap(pg.Pool);
    pg.Client = wrap(pg.Client);
    pg.__loopbackGuard = true;
  }
  let supabaseJs = null;
  try { supabaseJs = require('@supabase/supabase-js'); } catch { /* not installed */ }
  if (supabaseJs && !supabaseJs.createClient.__loopbackGuard) {
    const original = supabaseJs.createClient;
    const guarded = function createClient(url, ...rest) {
      const host = hostOfUrl(url);
      if (!isConstructAllowed(host)) throw blocked(`a Supabase client for ${host}`);
      return original(url, ...rest);
    };
    guarded.__loopbackGuard = true;
    try { supabaseJs.createClient = guarded; } catch { /* read-only export: the socket guard still applies */ }
  }
}

function installEgressGuard() {
  if (net.Socket.prototype.connect.__loopbackGuard) return;
  const original = net.Socket.prototype.connect;
  function guardedConnect(...args) {
    // net.connect / net.createConnection / the http agents / undici pass the normalized form
    // [options, callback]; a direct socket.connect() passes (options | port, host | path, ...).
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    let host = '';
    let isPath = false;
    if (first && typeof first === 'object') {
      host = first.host || first.hostname || '';
      isPath = Boolean(first.path);
    } else if (typeof first === 'string' && Number.isNaN(Number(first))) {
      isPath = true; // connect(path): a unix socket
    } else if (typeof args[1] === 'string') {
      host = args[1];
    }
    if (isPath || isLoopbackHost(host)) return original.apply(this, args);
    // Fail exactly like a dead network: really connect, but to a closed loopback port, so the socket
    // goes through its normal connecting state and the error arrives from libuv at the real point in
    // the event loop. The error is relabelled as the offline one (ENOTFOUND for a name, ECONNREFUSED
    // for an address), so retry and fallback logic take the path they take offline.
    const dead = { host: '127.0.0.1', port: 9 };
    // The normalized form is an array Node marks with an internal symbol: rewrite its options in
    // place (a copy would lose the mark and be re-parsed as plain arguments).
    let redirected = args;
    if (Array.isArray(args[0])) args[0][0] = { ...args[0][0], ...dead, hostname: undefined };
    else if (first && typeof first === 'object') redirected = [{ ...first, ...dead, hostname: undefined }, ...args.slice(1)];
    else redirected = [dead.port, dead.host, ...args.slice(2)];
    const message = `EGRESS_BLOCKED: a test tried to open a connection to ${host} (tests/setup-loopback.js)`;
    const code = net.isIP(host) ? 'ECONNREFUSED' : 'ENOTFOUND';
    const emit = this.emit;
    this.emit = function relabel(event, err, ...rest) {
      if (event === 'error' && err && !err.egressBlocked) {
        err.message = message;
        err.code = code;
        err.egressBlocked = true;
        err.blockedHost = host;
      }
      return emit.call(this, event, err, ...rest);
    };
    return original.apply(this, redirected);
  }
  guardedConnect.__loopbackGuard = true;
  net.Socket.prototype.connect = guardedConnect;
}

if (process.env.ALLOW_LIVE_SERVICES_IN_TESTS !== '1') {
  applyLoopbackEnv();
  installConstructorGuards();
  installEgressGuard();
}

module.exports = { applyLoopbackEnv, installConstructorGuards, installEgressGuard, loopbackFor };
