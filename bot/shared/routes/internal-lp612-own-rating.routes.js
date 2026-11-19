'use strict';
/**
 * bd-snkn32.11 (queue #134 C) — POST /api/internal/lp612/own/:ownId/rating { userId, rating, confusing? } → 200
 * { success }. Her rating of her own plan (services/lp612-own-rating.js holds the rules). userId is the portal
 * SESSION's user. Mounted from internal-api.routes.js beside internal-lp612-own.routes.js.
 *
 *   saved → 200   bad_request → 400   not_found → 404 (not hers, not ready, no such plan)   error → 500
 */
const express = require('express');
const { requireInternalKey } = require('../middleware/require-internal-key');

const router = express.Router();
const HTTP = { saved: 200, bad_request: 400, not_found: 404 };

router.post('/lp612/own/:ownId/rating', requireInternalKey, async (req, res) => {
  const b = req.body || {};
  const out = await require('../services/lp612-own-rating').rate(
    String(req.params.ownId || '').trim(), String(b.userId || '').trim(), { rating: b.rating, confusing: b.confusing },
  );
  const status = HTTP[out.outcome] || 500;
  return res.status(status).json(status === 200 ? { success: true } : { success: false, error: out.outcome });
});

module.exports = router;
