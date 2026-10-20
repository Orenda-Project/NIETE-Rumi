'use strict';
/**
 * The coach card — v10 coaching test, bd-v0toag.38.9. The link in the coach's WhatsApp ping
 * (coach_visit_request_v2) when a C/D teacher does not agree with her report.
 *
 *   GET  /cv/:token          her name, school, score and section scores, what she said wasn't right, and her
 *                            voice note on an hour-long link. Read-only, signs nobody in.
 *   POST /cv/:token/visited  "I have visited": the request reads visited, her voice note is deleted, 303 back.
 *
 * The token (dashboard/services/coach-card-token.js) names one coach_visit_requests row; a bad, expired or
 * report link is a 404 with no data. The token is never logged; every answer is private and no-store.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyCoachCard, CARD_PATH } = require('../services/coach-card-token');
const { renderCoachCard } = require('../services/coach-ping-page');
const { renderMessagePage } = require('../services/coaching-report-page');
const telemetry = require('../services/telemetry.service');

function log(event, props) {
  try { telemetry.logEvent(event, props); } catch (_) { /* logging never decides the response */ }
}

function createCoachCardRouter(opts = {}) {
  const db = () => require('../config/supabase');
  const svc = () => require('../services/coach-visit-request');
  const loadReport = (...a) => require('./coaching-report.routes').loadReport(...a);
  const loadCard = opts.loadCard || ((id) => svc().loadCard(db(), id, { loadReport }));
  const markVisited = opts.markVisited || ((id) => svc().markVisited(db(), id));
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, validate: false,
    handler: (req, res) => res.status(429).type('html').send(renderMessagePage('error')),
  });
  const privateHeaders = (req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    next();
  };
  const requestOf = (req, res) => {
    const v = verifyCoachCard(String(req.params.token || ''));
    if (v.ok) return v.requestId;
    res.status(404).type('html').send(renderMessagePage('not_found'));
    return null;
  };

  router.get(`${CARD_PATH}/:token`, privateHeaders, limiter, async (req, res) => {
    const requestId = requestOf(req, res);
    if (!requestId) return undefined;
    let card;
    try {
      card = await loadCard(requestId);
    } catch (_) {
      return res.status(503).type('html').send(renderMessagePage('error'));
    }
    if (!card) return res.status(404).type('html').send(renderMessagePage('not_found'));
    log('coaching.coach_card.open', { requestId, status: card.status });
    return res.status(200).type('html').send(renderCoachCard(card, `${CARD_PATH}/${req.params.token}/visited`));
  });

  router.post(`${CARD_PATH}/:token/visited`, privateHeaders, limiter, async (req, res) => {
    const requestId = requestOf(req, res);
    if (!requestId) return undefined;
    const ok = await Promise.resolve(markVisited(requestId)).catch(() => false);
    if (!ok) return res.status(503).type('html').send(renderMessagePage('error'));
    log('coaching.coach_card.visited', { requestId });
    return res.redirect(303, `${CARD_PATH}/${req.params.token}`);
  });
  return router;
}

module.exports = { createCoachCardRouter };
