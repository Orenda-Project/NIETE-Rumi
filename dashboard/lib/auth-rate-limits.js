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
 * The client is req.ip, through `trust proxy` 1 in index.js (Railway's edge is the one hop in front of the portal).
 * The portal shows its own "Too many tries" for any 429 (portal/src/portal/auth/errors.ts); the body is not shown.
 */
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
  const perIpAndRoute = (req) => `${req.ip}-${req.path}`;
  const loginAccount = (req) => accountKey(req.body && req.body.phoneNumber);
  return {
    publicAuthLimiter: limiter('sign-in', LIMITS.signIn, perIpAndRoute),
    tokenValidationLimiter: limiter('token', LIMITS.token, perIpAndRoute),
    codeSendLimiter: limiter('code-send', LIMITS.codeSend, perIpAndRoute),
    accountLoginLimiter: limiter('account', LIMITS.account, loginAccount, { skip: (req) => !loginAccount(req) }),
  };
}

module.exports = { LIMITS, SharedStore, accountKey, createAuthLimiters };
