'use strict';
/**
 * bd-snkn32 — POST /api/internal/lp612/own { userId, segmentId, answers, correlationId? } → 202 { success, state, renderId }.
 *
 * "Make my own": her class answers rewrite a 6-12 plan into a fork that is hers (services/lp612-own.service.js holds
 * every rule; this maps its outcome to a status). `renderId` is her fork's id, polled on the SAME /lp612/status and
 * /lp612/file as a shared lesson (lp612-browse renderStatus answers it). userId is the portal SESSION's user.
 * Mounted from internal-api.routes.js (router.use), like internal-share.routes.js.
 *
 *   queued → 202   bad_request → 400   held → 403   not_found → 404   error / a throw → 500
 */
const express = require('express');
const { logToFile } = require('../utils/logger');
const { requireInternalKey } = require('../middleware/require-internal-key');

const router = express.Router();
const HTTP = { bad_request: 400, held: 403, not_found: 404 };

router.post('/lp612/own', requireInternalKey, async (req, res) => {
  const body = req.body || {};
  try {
    const out = await require('../services/lp612-own.service').requestOwn({
      userId: String(body.userId || '').trim(),
      segmentId: String(body.segmentId || '').trim(),
      answers: body.answers,
      correlationId: body.correlationId || null,
    });
    if (out.outcome === 'queued') {
      return res.status(202).json({ success: true, state: 'authoring', renderId: out.ownId });
    }
    return res.status(HTTP[out.outcome] || 500).json({ success: false, error: out.error || out.outcome });
  } catch (error) {
    logToFile('❌ Internal LP 6-12 own request failed', { error: error && error.message }, 'error');
    return res.status(500).json({ success: false, error: 'Could not make your plan' });
  }
});

module.exports = router;
