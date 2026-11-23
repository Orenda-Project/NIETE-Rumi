'use strict';
/**
 * The teacher app's class link card (switches web_quiz_class_link and web_quiz_evening_round, decided by the BOT; OFF
 * by default). Mounted at /api/portal by dashboard/index.js beside the other teacher modules (same CORS / limiter /
 * session stack). Each route proxies to the bot's /api/internal/wq/cl/app* with the internal key.
 *
 *   GET  /api/portal/class-link       → bot POST /cl/app {teacher}: {classes, reportHref}; the bot's 404 → 404 {success:false, off:true}
 *   POST /api/portal/class-link/tap   {classId, how: forward|copy} → bot POST /cl/app/tap {teacher, class_id, how}
 *
 * Guards, in order: no portal session → 401 (the bot is never asked); a bad class id or how → 400 (nor is it asked);
 * no bot configured or the bot's 404 → 404; unreachable → 503. The teacher is ALWAYS req.session.portalUserId: a
 * teacher or user_id in the query or body is dropped, so a teacher is only ever shown their own classes.
 */
const express = require('express');
const { createBotClient, clientIp } = require('./web-quiz.routes');

const BOT_BASE = '/api/internal/wq/cl';
const OFF = { success: false, off: true };
const ID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOWS = ['forward', 'copy'];

// The portal's one sign-in check (lib/portal-auth.js): it also ends the session of a retired account.
const { requirePortalAuth } = require('../lib/portal-auth');

const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

function createPortalTeacherClassLinkRouter(opts = {}) {
  const rateLimit = require('express-rate-limit');
  const botUrl = String(opts.botUrl != null ? opts.botUrl : (process.env.MAIN_BOT_URL || '')).replace(/\/$/, '');
  const apiKey = opts.apiKey != null ? opts.apiKey : (process.env.INTERNAL_API_KEY || '');
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const callBot = createBotClient({ botUrl, apiKey, fetchImpl, ...(opts.logEvent ? { logEvent: opts.logEvent } : {}) });
  const router = express.Router();
  const json = express.json({ limit: '4kb' });
  const perUser = rateLimit({
    windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, validate: false,
    keyGenerator: (req) => (req.session && req.session.portalUserId ? `u:${req.session.portalUserId}` : `ip:${clientIp(req)}`),
    handler: (req, res) => res.status(429).json({ success: false, error: 'slow_down' }),
  });

  /** One bot call: {status, body} or a response already sent (null). */
  const ask = async (req, res, op, body) => {
    res.set('Cache-Control', 'no-store');
    if (!botUrl || !apiKey) { res.status(404).json(OFF); return null; }
    try {
      const out = await callBot('POST', `${BOT_BASE}${op}`, req, body, { route: `${BOT_BASE}${op}` });
      if (out.status === 404) { res.status(404).json(OFF); return null; }
      return out;
    } catch (_) {
      res.status(503).json({ success: false, error: 'unavailable' });
      return null;
    }
  };

  router.get('/class-link', requirePortalAuth, async (req, res) => {
    const out = await ask(req, res, '/app', { teacher: req.session.portalUserId });
    if (out) res.status(out.status).json(out.body || {});
  });
  router.post('/class-link/tap', requirePortalAuth, perUser, json, async (req, res) => {
    const b = bodyOf(req);
    if (typeof b.classId !== 'string' || !ID_RX.test(b.classId) || !HOWS.includes(b.how)) {
      res.set('Cache-Control', 'no-store');
      return res.status(400).json({ success: false, error: 'bad_request' });
    }
    const out = await ask(req, res, '/app/tap', { teacher: req.session.portalUserId, class_id: b.classId, how: b.how });
    if (out) res.status(out.status).json(out.body || {});
    return undefined;
  });
  return router;
}

module.exports = createPortalTeacherClassLinkRouter();
module.exports.createPortalTeacherClassLinkRouter = createPortalTeacherClassLinkRouter;
