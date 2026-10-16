/**
 * The one door's public edge (switch quiz_one_door, read by the bot).
 *
 *   GET  /quiz/go/:token     the landing of the ONE /quiz reply. A token whose side is `unknown` gets the one question
 *                            page rendered HERE, verified with the hub's signer, without waiting on the bot (the page asks
 *                            the bot who this phone is after paint, /api/go/who). Every other token is forwarded to the
 *                            bot (/api/internal/go/land), which re-resolves the person and answers a 302 to their home.
 *   POST /api/go/who {t}     → the bot: {side, next|null}
 *   POST /api/go/role {t, side}  → the bot: {next}
 *   POST /api/go/bind {t, kid}   → the bot: {next}
 * Every forward goes through the child quiz's bot client (web-quiz.routes createBotClient: x-api-key, the caller's
 * address, the phone's wq_dv device ref, a timeout, redirects never followed). A phone with no wq_dv gets one here
 * (the landing is bound to its first device). Only a Location of this site's own pages is passed on.
 *
 * The bot answers 404 {off:true} when the switch is off: the edge then calls next() (today's handling). A malformed
 * token also falls through, with no bot call. A bot that cannot be reached → the go.error page / 503 {error:'go.error'}.
 * The edge never touches the database.
 */
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createBotClient, clientIp } = require('./web-quiz.routes');
const GoPage = require('../../bot/shared/services/first-touch/go.page');
const GoToken = require('../../bot/shared/services/first-touch/go.token');

const TOKEN_RX = /^[A-Za-z0-9_-]{8,900}\.[A-Za-z0-9_-]{22}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOT_BASE = '/api/internal/go';
const DEVICE_COOKIE_RX = /(?:^|;\s*)wq_dv=([A-Za-z0-9_-]{22})(?:;|$)/;
const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

// The pages a landing may send a person on to: the teacher home, the child home (hub), the join screen, the landing itself.
const okLocation = (loc) => typeof loc === 'string' && /^\/(quiz\/teacher|quiz\/go|quiz\/home|h|j)\/[A-Za-z0-9_.%-]+(\?[A-Za-z0-9_=&%.-]*)?$/.test(loc);

const FORM = {
  who: {},
  role: { side: (v) => v === 'child' || v === 'teacher' },
  bind: { kid: (v) => UUID_RX.test(v) },
};
function formBody(kind, body) {
  const out = {};
  Object.entries(FORM[kind]).forEach(([k, ok]) => {
    const v = body && body[k];
    if (typeof v === 'string' && ok(v)) out[k] = v;
  });
  return out;
}

function langOfToken(t) {
  try { const v = GoToken.verifyGo(t); const p = v && (v.ok || v.stale); return p && p.lang === 'ur' ? 'ur' : 'bi'; } catch (_) { return 'bi'; }
}

function sendPage(res, built, status = 200) {
  res.set({ ...PRIVATE, 'Content-Security-Policy': built.csp });
  return res.status(status).type('html').send(built.html);
}

/** The bot's "switch off" answer: 404 with the JSON body {off:true}. */
function isOff(out) {
  if (!out || out.status !== 404) return false;
  if (out.body && typeof out.body === 'object') return out.body.off === true;
  try { return JSON.parse(Buffer.from(out.bytes || '').toString('utf8')).off === true; } catch (_) { return false; }
}

function createQuizGoRouter(opts = {}) {
  let { callBot } = opts;
  let configured = typeof callBot === 'function';
  if (!configured) {
    const botUrl = String(opts.botUrl != null ? opts.botUrl : (process.env.MAIN_BOT_URL || '')).replace(/\/$/, '');
    const apiKey = opts.apiKey != null ? opts.apiKey : (process.env.INTERNAL_API_KEY || '');
    const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
    callBot = createBotClient({ botUrl, apiKey, fetchImpl });
    configured = Boolean(botUrl && apiKey);
  }
  const verify = opts.verifyGo || GoToken.verifyGo;
  const router = express.Router();

  const limiter = rateLimit({
    windowMs: 60 * 1000, max: 120, standardHeaders: false, legacyHeaders: false, validate: false,
    keyGenerator: (req) => `go:${clientIp(req)}`,
    handler: (req, res) => sendPage(res, GoPage.buildMessagePage({ id: 'go.error' }), 429),
  });
  const lenient = (parser) => (req, res, next) => parser(req, res, (err) => { if (err) req.body = {}; next(); });
  const parse = [lenient(express.json({ limit: '4kb' }))];

  /** This phone's device ref, minting (and setting) one when it has none. */
  function device(req, res) {
    const m = DEVICE_COOKIE_RX.exec(String((req.get && req.get('cookie')) || ''));
    if (m) return m[1];
    const minted = crypto.randomBytes(16).toString('base64url');
    const secure = req.secure || String(req.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https';
    res.append('Set-Cookie', `wq_dv=${minted}; Path=/; Max-Age=2592000; SameSite=Lax${secure ? '; Secure' : ''}`);
    return minted;
  }

  router.get('/quiz/go/:token', limiter, async (req, res, next) => {
    const token = String(req.params.token || '');
    if (!TOKEN_RX.test(token) || !configured) return next();
    const dv = device(req, res);
    // an unknown phone's question never waits on the bot: verified here, the who-am-I call follows the paint
    const v = verify(token);
    if (v && v.ok && v.ok.side === 'unknown') return sendPage(res, GoPage.buildRolePage({ t: token, lang: v.ok.lang }));
    let out;
    try {
      out = await callBot('GET', `${BOT_BASE}/land/${token}`, req, null, { raw: true, device: dv, route: '/api/internal/go/land/:t' });
    } catch (_) {
      return sendPage(res, GoPage.buildMessagePage({ id: 'go.error', lang: langOfToken(token) }), 503);
    }
    if (isOff(out)) return next();
    if (out.status >= 300 && out.status < 400) {
      if (!okLocation(out.location)) return sendPage(res, GoPage.buildMessagePage({ id: 'go.error', lang: langOfToken(token) }), 502);
      res.set(PRIVATE);
      return res.redirect(302, out.location);
    }
    if (out.status >= 500) return sendPage(res, GoPage.buildMessagePage({ id: 'go.error', lang: langOfToken(token) }), 503);
    res.set(PRIVATE);   // the bot's page carries its own Content-Security-Policy <meta>
    return res.status(out.status).type(out.contentType || 'text/html; charset=utf-8').send(out.bytes || Buffer.alloc(0));
  });

  function forwardPost(kind) {
    return async (req, res, next) => {
      const t = req.body && typeof req.body.t === 'string' ? req.body.t : '';
      if (!TOKEN_RX.test(t) || !configured) return next();
      let out;
      try {
        out = await callBot('POST', `${BOT_BASE}/${kind}`, req, { t, ...formBody(kind, req.body) }, { route: `/api/internal/go/${kind}` });
      } catch (_) {
        res.set(PRIVATE);
        return res.status(503).json({ error: 'go.error' });
      }
      if (isOff(out)) return next();
      res.set(PRIVATE);
      if (out.status >= 500) return res.status(503).json({ error: 'go.error' });
      const body = out.body && typeof out.body === 'object' ? out.body : {};
      if (body.next != null && !okLocation(body.next)) return res.status(502).json({ error: 'go.error' });
      return res.status(out.status).json(body);
    };
  }

  router.post('/api/go/who', limiter, parse, forwardPost('who'));
  router.post('/api/go/role', limiter, parse, forwardPost('role'));
  router.post('/api/go/bind', limiter, parse, forwardPost('bind'));
  return router;
}

module.exports = { createQuizGoRouter, okLocation, TOKEN_RX };
