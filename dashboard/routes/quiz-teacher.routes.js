/**
 * The teacher home's public edge. Forwards path-for-path to the bot's /api/internal/th (+ the same path) through the
 * child quiz's bot client (web-quiz.routes createBotClient: x-api-key, the caller's address, a timeout, redirects
 * never followed). It never verifies a token and never touches the database: the bot renders and decides.
 *
 *   GET  /quiz/teacher/:token            the page shell (HTML)
 *   GET  /quiz/teacher/:token/send       a library code's send (?c, ?o, ?lang): the bot marks it sent, 302 → wa.me
 *   GET  /quiz/teacher/:token/stories    the stories page (served by the stories router on the bot); ?book (a story
 *                                        tile's book: its send sheet), ?grade (1-5) and ?lang reach it
 *   GET  /api/th/home  ?t&g&lang         the home's JSON
 *   GET  /api/th/library ?t&g&lang       the library card for a grade
 *   GET  /api/th/quiz/:id ?t&lang        the "Quiz this" poll
 *   POST /api/th/send | quiz/make | confirm | step    JSON in, JSON (or 204) out
 *
 * Switch quiz_teacher_home OFF: the bot answers 404 {off:true} and this edge calls next(), so the request falls
 * through to exactly today's handling (nothing is set on the response before that). A malformed token also falls
 * through, with no bot call. A bot that cannot be reached or answers 5xx: the page routes get the small static
 * mk.error page in the request's language, the JSON routes 503 {error:'mk.error'}. A caller over the rate limit also
 * falls through, with no bot call (never a 429: with the switch off this edge must not be seen at all).
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createBotClient, clientIp } = require('./web-quiz.routes');
const { buildMessagePage } = require('../../bot/shared/services/first-touch/maker.page');

// base64url(payload) "." base64url(HMAC)[:22] — web-quiz-token's format.
const TOKEN_RX = /^[A-Za-z0-9_-]{8,900}\.[A-Za-z0-9_-]{22}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RX = /^[A-Za-z0-9_:.-]{1,200}$/;
const BOT_BASE = '/api/internal/th';
const LANG = (v) => v === 'en' || v === 'ur';
const ONE_OF = (...vals) => (v) => vals.includes(v);

// The query keys each GET may carry to the bot; anything else is dropped.
const QUERY = { t: (v) => TOKEN_RX.test(v), g: (v) => /^[1-5]$/.test(v), lang: LANG };
// The query keys a page may carry: the shell reads lang; the stories page also the tile's book and the grade; the send
// the library code and where the send started.
const PAGE_QUERY = { book: (v) => UUID_RX.test(v), grade: (v) => /^[1-5]$/.test(v), lang: LANG };
const SEND_QUERY = { c: (v) => UUID_RX.test(v), o: ONE_OF('library', 'again', 'lesson_plan', 'coaching'), lang: LANG };
const PAGE_KEYS = { '': { lang: LANG }, '/stories': PAGE_QUERY, '/send': SEND_QUERY };
function forwardQuery(q, keys = QUERY) {
  const out = Object.keys(keys).filter((k) => typeof q[k] === 'string' && keys[k](q[k])).map((k) => `${k}=${encodeURIComponent(q[k])}`);
  return out.length ? `?${out.join('&')}` : '';
}

// The fields each POST may carry, and their shape; anything else is dropped. `t` is checked separately.
const FORM = {
  send: { kind: ONE_OF('video', 'share', 'again'), id: (v) => UUID_RX.test(v), lang: LANG },
  'quiz/make': { kind: ONE_OF('lesson', 'coaching'), id: (v) => KEY_RX.test(v), lang: LANG },
  confirm: { looseId: (v) => UUID_RX.test(v), candidateId: (v) => UUID_RX.test(v), decision: ONE_OF('same', 'no', 'unsure') },
  step: { step: (v) => /^[a-z_]{2,30}$/.test(v), kind: ONE_OF('video', 'share', 'again', 'story'), id: (v) => UUID_RX.test(v), c: (v) => UUID_RX.test(v), origin: ONE_OF('library', 'again', 'lesson_plan', 'coaching') },
};
function formBody(kind, body) {
  const out = {};
  Object.entries(FORM[kind]).forEach(([k, ok]) => {
    const v = body && body[k];
    if (typeof v === 'string' && ok(v)) out[k] = v;
  });
  return out;
}

/** The request's language for an edge-made page: ?lang, else the phone's Accept-Language, else English. */
function langOf(req) {
  const asked = req.query && req.query.lang;
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

// A Location the edge passes on: WhatsApp's share link, or a page of this site.
const okLocation = (loc) => typeof loc === 'string' && (/^https:\/\/wa\.me\//.test(loc) || /^\/(quiz\/teacher|quiz\/join|m|h|r)\/[A-Za-z0-9_.%-]+(\/[a-z]+)?(\?[^\s]*)?$/.test(loc));

function createQuizTeacherRouter(opts = {}) {
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

  // Per caller address. Over the limit → this route is skipped (next('route')) and the request falls through to
  // today's handling untouched, exactly as with the switch off: no 429, no rate headers, no bot call.
  const limiter = rateLimit({
    windowMs: 60 * 1000, max: opts.limit || 240, standardHeaders: false, legacyHeaders: false, validate: false,
    keyGenerator: (req) => `th:${clientIp(req)}`,
    handler: (req, res, next) => next('route'),
  });
  // Its own small body parser; a body too large or unreadable is an empty one (the bot then refuses it).
  const parse = (req, res, next) => express.json({ limit: '4kb' })(req, res, (err) => { if (err) req.body = {}; next(); });

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

  function forwardPage(suffix = '') {
    return async (req, res, next) => {
      const token = String(req.params.token || '');
      if (!TOKEN_RX.test(token) || !configured) return next();
      const query = forwardQuery(req.query || {}, PAGE_KEYS[suffix]);
      let out;
      try {
        out = await callBot('GET', `${BOT_BASE}/quiz/teacher/${token}${suffix}${query}`, req, null, { raw: true });
      } catch (_) {
        return errorPage(req, res);
      }
      if (!relay(req, res, out, { json: false })) return next();
      return undefined;
    };
  }

  function forwardGetJson(path) {
    return async (req, res, next) => {
      const t = req.query && typeof req.query.t === 'string' ? req.query.t : '';
      if (!TOKEN_RX.test(t) || !configured) return next();
      const id = req.params.id;
      if (id !== undefined && !UUID_RX.test(id)) return next();
      let out;
      try {
        out = await callBot('GET', `${BOT_BASE}${path}${id !== undefined ? `/${id}` : ''}${forwardQuery(req.query || {})}`, req, null, { raw: true });
      } catch (_) {
        return errorJson(res);
      }
      if (!relay(req, res, out, { json: true })) return next();
      return undefined;
    };
  }

  function forwardPost(kind) {
    return async (req, res, next) => {
      const t = req.body && typeof req.body.t === 'string' ? req.body.t : '';
      if (!TOKEN_RX.test(t) || !configured) return next();
      let out;
      try {
        out = await callBot('POST', `${BOT_BASE}/api/th/${kind}`, req, { t, ...formBody(kind, req.body) }, { raw: true });
      } catch (_) {
        return errorJson(res);
      }
      if (!relay(req, res, out, { json: true })) return next();
      return undefined;
    };
  }

  router.get('/quiz/teacher/:token', limiter, forwardPage());
  router.get('/quiz/teacher/:token/stories', limiter, forwardPage('/stories'));
  router.get('/quiz/teacher/:token/send', limiter, forwardPage('/send'));
  router.get('/api/th/home', limiter, forwardGetJson('/api/th/home'));
  router.get('/api/th/library', limiter, forwardGetJson('/api/th/library'));
  router.get('/api/th/quiz/:id', limiter, forwardGetJson('/api/th/quiz'));
  ['send', 'quiz/make', 'confirm', 'step'].forEach((kind) => router.post(`/api/th/${kind}`, limiter, parse, forwardPost(kind)));
  return router;
}

module.exports = { createQuizTeacherRouter, TOKEN_RX };
