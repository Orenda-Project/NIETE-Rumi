'use strict';
/**
 * The teacher's evening reminder (web push on the portal; switches portal_push_remind AND web_quiz_push_remind, decided
 * by the BOT; OFF by default). Mounted at /api/portal by dashboard/index.js beside the other teacher modules (same CORS /
 * limiter / session stack). Each route proxies to the bot's /api/internal/wqpush/* with the internal key.
 *
 *   GET  /api/portal/push/state        → {portal:true, test} (bot /state says portal:true); else 404 {success:false, off:true}
 *   POST /api/portal/push/subscribe    {sub, lang}  → bot /portal/subscribe {sub, lang, user_id}
 *   POST /api/portal/push/unsubscribe  {endpoint}   → bot /portal/unsubscribe {endpoint, user_id}
 *   POST /api/portal/push/test         {endpoint}   → bot /portal/test {endpoint, user_id} (bot: web_quiz_push_test only)
 *
 * Guards, in order: no portal session → 401 (the bot is never asked); no bot configured or the bot's 404 → 404;
 * unreachable → 503. The teacher is ALWAYS req.session.portalUserId: any user_id in the body is dropped.
 */
const express = require('express');
const { createBotClient, clientIp } = require('./web-quiz.routes');

const BOT_BASE = '/api/internal/wqpush';
const OFF = { success: false, off: true };

// The portal's one sign-in check (lib/portal-auth.js): it also ends the session of a retired account.
const { requirePortalAuth } = require('../lib/portal-auth');

const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const LANGS = ['en', 'ur'];

function createPortalTeacherPushRouter(opts = {}) {
  const rateLimit = require('express-rate-limit');
  const botUrl = String(opts.botUrl != null ? opts.botUrl : (process.env.MAIN_BOT_URL || '')).replace(/\/$/, '');
  const apiKey = opts.apiKey != null ? opts.apiKey : (process.env.INTERNAL_API_KEY || '');
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const callBot = createBotClient({ botUrl, apiKey, fetchImpl, ...(opts.logEvent ? { logEvent: opts.logEvent } : {}) });
  const router = express.Router();
  const json = express.json({ limit: '8kb' });
  const perUser = rateLimit({
    windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, validate: false,
    keyGenerator: (req) => (req.session && req.session.portalUserId ? `u:${req.session.portalUserId}` : `ip:${clientIp(req)}`),
    handler: (req, res) => res.status(429).json({ success: false, error: 'slow_down' }),
  });

  /** One bot call: {status, body} or a response already sent (null). */
  const ask = async (req, res, method, op, body) => {
    res.set('Cache-Control', 'no-store');
    if (!botUrl || !apiKey) { res.status(404).json(OFF); return null; }
    try {
      const out = await callBot(method, `${BOT_BASE}${op}`, req, body, { route: `${BOT_BASE}${op}` });
      if (out.status === 404) { res.status(404).json(OFF); return null; }
      return out;
    } catch (_) {
      res.status(503).json({ success: false, error: 'unavailable' });
      return null;
    }
  };
  const relay = (op, pick) => async (req, res) => {
    const out = await ask(req, res, 'POST', op, { ...pick(bodyOf(req)), user_id: req.session.portalUserId });
    if (out) res.status(out.status).json(out.body || {});
  };

  router.get('/push/state', requirePortalAuth, async (req, res) => {
    const out = await ask(req, res, 'GET', '/state', null);
    if (!out) return;
    const b = out.body || {};
    if (out.status !== 200 || b.portal !== true) return res.status(404).json(OFF);
    return res.json({ portal: true, test: b.test === true });
  });
  router.post('/push/subscribe', requirePortalAuth, json,
    relay('/portal/subscribe', (b) => ({ sub: b.sub, lang: LANGS.includes(b.lang) ? b.lang : 'ur' })));
  router.post('/push/unsubscribe', requirePortalAuth, json, relay('/portal/unsubscribe', (b) => ({ endpoint: b.endpoint })));
  router.post('/push/test', requirePortalAuth, perUser, json, relay('/portal/test', (b) => ({ endpoint: b.endpoint })));
  return router;
}

module.exports = createPortalTeacherPushRouter();
module.exports.createPortalTeacherPushRouter = createPortalTeacherPushRouter;
