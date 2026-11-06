/**
 * bd-e0dqwz — the rate limits on the portal's public sign-in endpoints (routes/portal.routes.js).
 *
 * Until this module they allowed 10000 a minute. digital-coach-dashboard set that on 2025-11-13 ("TEMP: disabled",
 * 1949491, to stop 429s while testing) and NIETE inherited it on 2026-01-27, so production served every password guess.
 *
 * Sized from 10 weeks of production traffic (Railway HTTP logs, 53,184 sign-in POSTs, 2026-08-15 → 2026-10-28;
 * 06_Logs & Misc/Investigations/workspace/pk-ict/infra/bd-e0dqwz-portal-auth-rate-limit/):
 *   - failed sign-ins from one IP: 99th percentile 11 in 15 minutes, the most ever 64 (one person retrying). 30 in
 *     15 minutes would have refused no attempt that went on to succeed.
 *   - good sign-ins are not counted, so a school on one Wi-Fi is never refused (the most from one IP: 83 in an hour).
 *   - one account: 10 wrong passwords in 15 minutes, from any number of IPs (one guess spread over many machines).
 *   - WhatsApp codes: 50 an hour from one IP (the most ever 45). The per-number limit stays in password-reset.service.
 *
 * The counts live in the portal's Redis (lib/edge-redis), so the four cluster workers and a redeploy share them.
 * While Redis is away each process counts in its own memory: it neither lets everything through nor refuses everyone.
 * The client is clientKey(req): on Railway the X-Real-IP header, elsewhere req.ip. On Railway req.ip is NOT the client.
 * Under `trust proxy` 1 it is the Railway proxy hop in front of the portal. The sandbox live check of 2026-11-05 saw
 * 31 failures from one machine alternate between two keys, so the 31st was never refused, and in production every
 * teacher would share those few keys. Railway's HTTP edge sets X-Real-IP to the connecting IP and replaces any value
 * the caller sends (Railway staff, station.railway.com, Oct 2026). Off Railway nothing sets it, so a caller's own
 * X-Real-IP is ignored there. An IPv6 client counts as its /64, which one household or phone usually holds whole.
 * The portal shows its own "Too many tries" for any 429 (portal/src/portal/auth/errors.ts); the body is not shown.
 */
const net = require('net');
const rateLimit = require('express-rate-limit');
const edgeRedis = require('./edge-redis');
const telemetry = require('../services/telemetry.service');
const { isAccountNameInput, normaliseAccountName } = require('./analytics-account-name');

const MINUTE = 60 * 1000;
const LIMITS = {
  signIn: { windowMs: 15 * MINUTE, max: 30, failuresOnly: true }, // per IP and route
  token: { windowMs: 15 * MINUTE, max: 20, failuresOnly: true }, // per IP and route
  codeSend: { windowMs: 60 * MINUTE, max: 50, failuresOnly: false }, // per IP and route; every send costs a message
  account: { windowMs: 15 * MINUTE, max: 10, failuresOnly: true }, // per account named in the sign-in
};

const TOO_MANY = { success: false, error: 'Too many attempts. Please try again later.' };

/** An express-rate-limit store on the shared Redis that counts in this process's memory while Redis is away. */
class SharedStore {
  constructor(name) {
    this.prefix = `rl:auth:${name}:`;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
    this.memory = new rateLimit.MemoryStore();
    this.memory.init(options);
  }

  async increment(key) {
    const shared = await edgeRedis.hit(this.prefix + key, this.windowMs);
    if (shared) return { totalHits: shared.n, resetTime: new Date(Date.now() + Math.max(shared.ttlMs, 0)) };
    return this.memory.increment(key);
  }

  async decrement(key) {
    if (!(await edgeRedis.unhit(this.prefix + key))) await this.memory.decrement(key);
  }

  async resetKey(key) {
    await edgeRedis.forget(this.prefix + key);
    await this.memory.resetKey(key);
  }
}

/** An IPv6 address as its /64 ('2001:db8:1:2::/64'); an IPv4 address (or an IPv4-mapped one) as itself. */
function subnetOf(ip) {
  if (!net.isIPv6(ip)) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

/** The client a per-IP limit counts: X-Real-IP on Railway (set by its edge), req.ip anywhere else. */
function clientKey(req) {
  const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_ENVIRONMENT);
  const real = onRailway ? String(req.get('x-real-ip') || '').trim() : '';
  return subnetOf(net.isIP(real) ? real : req.ip);
}

/** The account a sign-in names, one key however it is typed ('0300…', '+92 300…', ' Admin'); null when none. */
function accountKey(raw) {
  if (typeof raw !== 'string') return null;
  if (isAccountNameInput(raw)) {
    const name = normaliseAccountName(raw);
    return name ? `name:${name}` : null;
  }
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 ? `phone:${digits.slice(-10)}` : null;
}

function limiter(name, { windowMs, max, failuresOnly }, keyGenerator, extra = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: failuresOnly,
    store: new SharedStore(name),
    keyGenerator,
    handler: (req, res, _next, options) => {
      telemetry.logEvent('portal.auth.rate_limited', { limiter: name, path: req.path });
      res.status(options.statusCode).json(TOO_MANY);
    },
    ...extra,
  });
}

/** One set per router: express-rate-limit refuses a store shared between two limiters. */
function createAuthLimiters() {
  const perIpAndRoute = (req) => `${clientKey(req)}-${req.path}`;
  const loginAccount = (req) => accountKey(req.body && req.body.phoneNumber);
  return {
    publicAuthLimiter: limiter('sign-in', LIMITS.signIn, perIpAndRoute),
    tokenValidationLimiter: limiter('token', LIMITS.token, perIpAndRoute),
    codeSendLimiter: limiter('code-send', LIMITS.codeSend, perIpAndRoute),
    accountLoginLimiter: limiter('account', LIMITS.account, loginAccount, { skip: (req) => !loginAccount(req) }),
  };
}

module.exports = { LIMITS, SharedStore, accountKey, clientKey, subnetOf, createAuthLimiters };
