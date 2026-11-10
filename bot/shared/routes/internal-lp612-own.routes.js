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
 *
 * bd-snkn32.15 — POST /api/internal/lp612/own/:ownId/change { userId, part, text, correlationId? }: "Change this plan"
 * (services/lp612-own-change.js). A guard refusal (too_short, too_small, repeat, in_flight, cap_reached, daily_limit;
 * daily_limit also on a make) is 409 with its `outcome`, so the portal can say why. Nothing was written or paid for.
 */
const express = require('express');
const { logToFile } = require('../utils/logger');
const { requireInternalKey } = require('../middleware/require-internal-key');

const router = express.Router();
const HTTP = { bad_request: 400, held: 403, not_found: 404 };
const REFUSED = new Set(['too_short', 'too_small', 'repeat', 'in_flight', 'cap_reached', 'daily_limit']);

function answer(res, out) {
  if (out.outcome === 'queued') return res.status(202).json({ success: true, state: 'authoring', renderId: out.ownId });
  if (REFUSED.has(out.outcome)) return res.status(409).json({ success: false, outcome: out.outcome, error: out.outcome });
  return res.status(HTTP[out.outcome] || 500).json({ success: false, error: out.error || out.outcome });
}

router.post('/lp612/own', requireInternalKey, async (req, res) => {
  const body = req.body || {};
  try {
    const out = await require('../services/lp612-own.service').requestOwn({
      userId: String(body.userId || '').trim(),
      segmentId: String(body.segmentId || '').trim(),
      // bd-snkn32.4 — a grades 1–5 day; the service refuses both or neither.
      lessonId: String(body.lessonId || '').trim() || undefined,
      answers: body.answers,
      correlationId: body.correlationId || null,
    });
    return answer(res, out);
  } catch (error) {
    logToFile('❌ Internal LP 6-12 own request failed', { error: error && error.message }, 'error');
    return res.status(500).json({ success: false, error: 'Could not make your plan' });
  }
});

router.post('/lp612/own/:ownId/change', requireInternalKey, async (req, res) => {
  const body = req.body || {};
  try {
    const out = await require('../services/lp612-own-change').requestChange({
      userId: String(body.userId || '').trim(),
      ownId: String(req.params.ownId || '').trim(),
      part: typeof body.part === 'string' ? body.part : undefined,
      text: typeof body.text === 'string' ? body.text : undefined,
      correlationId: body.correlationId || null,
    });
    return answer(res, out);
  } catch (error) {
    logToFile('❌ Internal LP own change failed', { error: error && error.message }, 'error');
    return res.status(500).json({ success: false, error: 'Could not change your plan' });
  }
});

module.exports = router;
