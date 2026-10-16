/**
 * The first touch's pages: the public edge.
 *
 *   GET  /m/:token            the teacher's quiz-maker page (HTML), from the bot's /api/internal/ft/m/:token
 *   GET  /m/:token/send       the maker's "Send to class group" (the bot's 302 → wa.me)
 *   POST /api/ft/make         the make {t, grade, subject, quizId} → JSON
 *   POST /api/ft/step         a chip tap {t, step, grade?, subject?, quizId?} → 204
 *   GET  /f/:token            the family door page; GET /f/:token/teacher its "I'm a teacher" hop (302 → wa.me)
 *   POST /api/ft/code         the family door's code box (302 → /q/<code>, or the page)
 *   POST /api/ft/door         the maker's "Change my choice" (302 → /f/<token>)
 *   POST /api/ft/tour         the maker's tour banner
 * Every one is forwarded to the bot at /api/internal/ft + the same path, through the child quiz's bot client
 * (web-quiz.routes createBotClient: x-api-key, the caller's address, a timeout, redirects never followed); the
 * status, a Location (wa.me, or a page of this site) and the content type are passed through.
 *
 * Switch quiz_maker_page OFF: the bot answers 404 {off:true} and this edge calls next(), so the request falls through
 * to exactly today's handling (nothing is set on the response before that). A malformed token also falls through,
 * with no bot call. A bot that cannot be reached or answers 5xx: the page routes get a small static mk.error page in
 * the request's language, the JSON routes 503 {error:'mk.error'}. The edge never touches the database.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createBotClient, clientIp } = require('./web-quiz.routes');
const { buildMessagePage } = require('../../bot/shared/services/first-touch/maker.page');

// base64url(payload) "." base64url(HMAC)[:22] — web-quiz-token's format (the report edge's TOKEN_RX).
const TOKEN_RX = /^[A-Za-z0-9_-]{8,900}\.[A-Za-z0-9_-]{22}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOT_BASE = '/api/internal/ft';
const LANG = (v) => v === 'en' || v === 'ur';
const WORD = (n) => (v) => new RegExp(`^[a-z_]{2,${n}}$`).test(v);

// The query keys each GET may carry to the bot; anything else is dropped.
const QUERY = { lang: LANG, l: LANG, c: (v) => UUID_RX.test(v) };
function forwardQuery(q) {
  const out = Object.keys(QUERY).filter((k) => typeof q[k] === 'string' && QUERY[k](q[k])).map((k) => `${k}=${encodeURIComponent(q[k])}`);
  return out.length ? `?${out.join('&')}` : '';
}

// The fields each POST may carry, and their shape; anything else is dropped. `t` is checked separately.
const FORM = {
  make: { grade: (v) => /^[1-5]$/.test(v), subject: WORD(40), quizId: (v) => UUID_RX.test(v) },
  step: { step: WORD(30), grade: (v) => /^[1-5]$/.test(v), subject: WORD(40), quizId: (v) => UUID_RX.test(v) },
  code: { code: (v) => v.length > 0 && v.length <= 300, l: LANG },
  door: {},
  tour: { action: WORD(20), how: WORD(10) },
};
function formBody(kind, body) {
  const out = {};
  Object.entries(FORM[kind]).forEach(([k, ok]) => {
    const v = body && body[k];
    if (typeof v === 'string' && ok(v)) out[k] = v;
  });
  return out;
}

/** The request's language for an edge-made page: ?lang / the form's l, else the phone's Accept-Language, else English. */
function langOf(req) {
  const asked = (req.query && req.query.lang) || (req.body && req.body.l);
  if (LANG(asked)) return asked;
  return /^\s*ur\b/i.test(String(req.get('accept-language') || '')) ? 'ur' : 'en';
}

const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };

function errorPage(req, res, status = 503) {
  const built = buildMessagePage({ lang: langOf(req), id: 'mk.error' });
  res.set({ ...PRIVATE, 'Content-Security-Policy': built.csp });
  return res.status(status).type('html').send(built.html);
}
function errorJson(res) {
  res.set(PRIVATE);
  return res.status(503).json({ error: 'mk.error' });
}

/** The bot's "switch off" answer: 404 with the JSON body {off:true}. */
function isOff(out) {
  if (!out || out.status !== 404) return false;
  if (out.body && typeof out.body === 'object') return out.body.off === true;
  try { return JSON.parse(Buffer.from(out.bytes || '').toString('utf8')).off === true; } catch (_) { return false; }
}

// A Location the edge passes on: WhatsApp's share link, or a page of this site the first touch serves.
const okLocation = (loc) => typeof loc === 'string' && (/^https:\/\/wa\.me\//.test(loc) || /^\/(q|f|m)\/[A-Za-z0-9_.%-]+(\?[^\s]*)?$/.test(loc));

function createFirstTouchRouter(opts = {}) {
  let { callBot } = opts;
  let configured = typeof callBot === 'function';
  if (!configured) {
    const botUrl = String(opts.botUrl != null ? opts.botUrl : (process.env.MAIN_BOT_URL || '')).replace(/\/$/, '');
    const apiKey = opts.apiKey != null ? opts.apiKey : (process.env.INTERNAL_API_KEY || '');
    const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
    callBot = createBotClient({ botUrl, apiKey, fetchImpl });
    configured = Boolean(botUrl && apiKey);
  }
  const router = express.Router();

  // Per caller address (the bot sees only this edge's). No rate headers: a request that falls through is untouched.
  const limiter = rateLimit({
    windowMs: 60 * 1000, max: 120, standardHeaders: false, legacyHeaders: false, validate: false,
    keyGenerator: (req) => `ft:${clientIp(req)}`,
    handler: (req, res) => errorPage(req, res, 429),
  });
  // Its own small body parsers; a body too large or unreadable is an empty one (the bot then refuses it).
  const lenient = (parser) => (req, res, next) => parser(req, res, (err) => { if (err) req.body = {}; next(); });
  const parse = [
    lenient(express.urlencoded({ extended: false, limit: '4kb' })),
    lenient(express.json({ limit: '4kb' })),
  ];

  /** Sends the bot's answer on; → false when the caller should fall through (switch off). */
  function relay(req, res, out, { json }) {
    if (isOff(out)) return false;
    if (out.status >= 300 && out.status < 400) {
      if (!okLocation(out.location)) {
        if (json) errorJson(res); else errorPage(req, res, 502);
        return true;
      }
      res.set(PRIVATE);
      res.redirect(out.status, out.location);
      return true;
    }
    if (out.status >= 500) { if (json) errorJson(res); else errorPage(req, res); return true; }
    res.set(PRIVATE);
    if (out.status === 204) { res.status(204).end(); return true; }
    res.status(out.status).type(out.contentType || (json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8')).send(out.bytes || Buffer.alloc(0));
    return true;
  }

  function forwardGet(suffix = '') {
    return async (req, res, next) => {
      const token = String(req.params.token || '');
      if (!TOKEN_RX.test(token) || !configured) return next();
      const base = req.path.startsWith('/f/') ? 'f' : 'm';
      let out;
      try {
        out = await callBot('GET', `${BOT_BASE}/${base}/${token}${suffix}${forwardQuery(req.query || {})}`, req, null, { raw: true });
      } catch (_) {
        return errorPage(req, res);
      }
      if (!relay(req, res, out, { json: false })) return next();
      return undefined;
    };
  }

  function forwardPost(kind, { json, tokenOptional = false }) {
    return async (req, res, next) => {
      const t = req.body && typeof req.body.t === 'string' ? req.body.t : '';
      const hasToken = TOKEN_RX.test(t);
      if ((!hasToken && !tokenOptional) || !configured) return next();
      const body = { ...(hasToken ? { t } : {}), ...formBody(kind, req.body) };
      let out;
      try {
        out = await callBot('POST', `${BOT_BASE}/api/ft/${kind}`, req, body, { raw: true });
      } catch (_) {
        return json ? errorJson(res) : errorPage(req, res);
      }
      if (!relay(req, res, out, { json })) return next();
      return undefined;
    };
  }

  router.get('/m/:token', limiter, forwardGet());
  router.get('/m/:token/send', limiter, forwardGet('/send'));
  router.post('/api/ft/make', limiter, parse, forwardPost('make', { json: true }));
  router.post('/api/ft/step', limiter, parse, forwardPost('step', { json: true }));
  // the family door's and the tour's routes: forwarded now so their changes need nothing here
  router.get('/f/:token', limiter, forwardGet());
  router.get('/f/:token/teacher', limiter, forwardGet('/teacher'));
  router.post('/api/ft/code', limiter, parse, forwardPost('code', { json: false, tokenOptional: true }));
  router.post('/api/ft/door', limiter, parse, forwardPost('door', { json: false }));
  router.post('/api/ft/tour', limiter, parse, forwardPost('tour', { json: true }));
  return router;
}

module.exports = { createFirstTouchRouter, TOKEN_RX };
