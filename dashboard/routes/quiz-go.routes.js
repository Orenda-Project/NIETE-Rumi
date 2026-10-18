/**
 * The one door's public edge (switch quiz_one_door, read by the bot). Forwards path-for-path; never verifies a token
 * (the portal holds no token secret: every page is rendered by the bot, as /q/, /h/ and /r/ are).
 *
 *   GET  /quiz/go/:token[?ask=1]   → the bot's /api/internal/go/land/:token: the one question (HTML), a 302 to the
 *                                    person's home, or the "Is it <First>?" sheet
 *   POST /api/go/who  {t, d?}      → the bot: {side, next|null, known?}
 *   POST /api/go/role {t, side}    → the bot: {next, side}
 *   POST /api/go/bind {t, pick, d?} → the bot: {next}
 *   POST /api/go/persona {t, as}   → the bot: the sandbox walk-through (its own module; 404 off → falls through)
 * Every forward goes through the child quiz's bot client (web-quiz.routes createBotClient: x-api-key, the caller's
 * address, the phone's wq_dv device ref, a timeout, redirects never followed). A phone with no wq_dv gets one here
 * (the landing link is bound to its first device). Only a Location of this site's own pages is passed on.
 *
 * The bot answers 404 {off:true} when the switch is off: the edge then calls next() — today's handling (the SPA
 * catch-all) answers, byte for byte. A malformed token, a bot that cannot be reached and a caller over the rate limit
 * all fall through the same way: the edge draws a page only after the bot answered with the switch on (a Location off
 * this site, a bot 5xx → go.error with its one "Open WhatsApp" tap). The edge reads no table of its own, except the
 * switch web_quiz_closed_way_back (lib/closed-way-back-switch.js, default OFF, cached 30 s, fail OFF), and only to draw
 * its own go.error page: ON →
 * that page ALWAYS carries ONE tap back to WhatsApp (the signed go.back sentence; wa.me/<bot>?text=quiz, or
 * whatsapp://send?text=quiz with no number); OFF → today's page.
 */
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createBotClient, clientIp } = require('./web-quiz.routes');
const GoPage = require('../../bot/shared/services/first-touch/go.page');
const ChatTap = require('../../bot/shared/services/first-touch/chat-tap');
const WayBackSwitch = require('../lib/closed-way-back-switch');

const TOKEN_RX = /^[A-Za-z0-9_-]{8,900}\.[A-Za-z0-9_-]{22}$/;
const BOT_BASE = '/api/internal/go';
const DEVICE_COOKIE_RX = /(?:^|;\s*)wq_dv=([A-Za-z0-9_-]{22})(?:;|$)/;
const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

// The pages a landing may send a person on to: the teacher home, the quiz-maker page, the child home (hub), the join
// screen, the landing.
const okLocation = (loc) => typeof loc === 'string' && /^\/(quiz\/teacher|quiz\/join|quiz\/go|quiz\/home|h|m)\/[A-Za-z0-9_.%-]+(\?[A-Za-z0-9_=&%.-]*)?$/.test(loc);

const FORM = {
  who: { d: (v) => /^[A-Za-z0-9_-]{22}$/.test(v) },
  role: { side: (v) => v === 'child' || v === 'teacher' },
  bind: { pick: (v) => /^[0-9a-f]{16}$/.test(v), d: (v) => /^[A-Za-z0-9_-]{22}$/.test(v) },
  persona: { as: (v) => v === 'fresh' || v === 'teacher_empty' || v === 'real' },
};
function formBody(kind, body) {
  const out = {};
  Object.entries(FORM[kind]).forEach(([k, ok]) => {
    const v = body && body[k];
    if (typeof v === 'string' && ok(v)) out[k] = v;
  });
  return out;
}

/** The request's language for an edge-made error page: the phone's Accept-Language (Urdu) else both. */
const langOf = (req) => (/^\s*ur\b/i.test(String((req.get && req.get('accept-language')) || '')) ? 'ur' : 'bi');

/** This deployment's dialable bot number (WHATSAPP_BOT_NUMBER, else REFERRAL_BOT_NUMBER — the share links' source). */
const botNumber = () => String(process.env.WHATSAPP_BOT_NUMBER || process.env.REFERRAL_BOT_NUMBER || '').replace(/\D/g, '') || null;

/** The go.error page for an answer the bot gave that this edge cannot pass on, with its one tap back to WhatsApp. */
// With the switch on the page speaks the link's language first (?lang=, then the token's): 'ur' → Urdu only, 'en' → the
// page with its English lines (the door has no English-only page); else the phone's, as today.
const linkGoLang = (req) => ({ ur: 'ur', en: 'bi' })[ChatTap.linkLang(req)] || null;
const errorPage = (req, door = false) => GoPage.buildMessagePage({ id: 'go.error', lang: (door === true && linkGoLang(req)) || langOf(req), bot: botNumber(), door: door === true });

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
  // web_quiz_closed_way_back for the edge's own go.error page; `opts.wayBackOn(req)` stands in for the read (tests)
  const wayBackOn = typeof opts.wayBackOn === 'function'
    ? opts.wayBackOn
    : (req) => WayBackSwitch.on(req && req.app && req.app.locals ? req.app.locals.supabase : null);
  const doorOf = async (req) => { try { return (await wayBackOn(req)) === true; } catch (_) { return false; } };
  const router = express.Router();

  const limiter = rateLimit({
    windowMs: 60 * 1000, max: 120, standardHeaders: false, legacyHeaders: false, validate: false,
    keyGenerator: (req) => `go:${clientIp(req)}`,
    handler: (req, res, next) => next('route'),   // over the limit: today's handling answers (no page of ours, no bot call)
  });
  const lenient = (parser) => (req, res, next) => parser(req, res, (err) => { if (err) req.body = {}; next(); });
  const parse = [lenient(express.json({ limit: '4kb' }))];

  /** This phone's device ref; a phone with none gets one (set on this answer, sent to the bot on this same call). */
  function device(req, res) {
    const m = DEVICE_COOKIE_RX.exec(String((req.get && req.get('cookie')) || ''));
    if (m) return { ref: m[1], minted: null };
    const minted = crypto.randomBytes(16).toString('base64url');
    const secure = req.secure || String(req.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https';
    return { ref: minted, minted: `wq_dv=${minted}; Path=/; Max-Age=2592000; SameSite=Lax${secure ? '; Secure' : ''}` };
  }

  router.get('/quiz/go/:token', limiter, async (req, res, next) => {
    const token = String(req.params.token || '');
    if (!TOKEN_RX.test(token) || !configured) return next();
    const dv = device(req, res);
    const ask = req.query && req.query.ask === '1' ? '?ask=1' : '';
    let out;
    try {
      out = await callBot('GET', `${BOT_BASE}/land/${token}${ask}`, req, null, { raw: true, device: dv.ref, route: '/api/internal/go/land/:t' });
    } catch (_) {
      return next();   // the bot cannot be reached: today's handling answers (the edge draws no page of its own)
    }
    if (isOff(out)) return next();   // nothing was set on the response: today's handling answers
    if (dv.minted) res.append('Set-Cookie', dv.minted);
    if (out.status >= 300 && out.status < 400) {
      if (!okLocation(out.location)) return sendPage(res, errorPage(req, await doorOf(req)), 502);
      res.set(PRIVATE);
      return res.redirect(302, out.location);
    }
    if (out.status >= 500) return sendPage(res, errorPage(req, await doorOf(req)), 503);
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
        return next();   // the bot cannot be reached: today's handling answers
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
  router.post('/api/go/persona', limiter, parse, forwardPost('persona'));
  return router;
}

module.exports = { createQuizGoRouter, okLocation, TOKEN_RX };
