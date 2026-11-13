'use strict';
/**
 * bd-snkn32.42 — the "Made by a teacher" shelf and the human check before a plan is listed (internal, x-api-key).
 * Every rule is in the services (lp612-own-library, lp612-own-approval); these map input and outcome to HTTP.
 * Who may review is decided by the portal (app_settings portal_lp_own_reviewers); reviewerId is its session user.
 *
 *   GET  /lp612/own/shelf?keys=a,b           → { success, plans: [{ ownId, lesson, band, lang }] }   no keys 400
 *   GET  /lp612/own/review                   → { success, plans: [queue entries] }
 *   POST /lp612/own/review/:ownId { reviewerId, decision: approve|reject, reason? }
 *                                            → 200 { success, decision }  bad_request 400  not_found 404  error 500
 *   GET  /lp612/own/review/:ownId/file       → { success, url } (fresh presigned link)   not reviewable 404
 * Mounted from internal-api.routes.js (router.use), like internal-lp612-own.routes.js.
 */
const express = require('express');
const { logToFile } = require('../utils/logger');
const { requireInternalKey } = require('../middleware/require-internal-key');

const router = express.Router();
const HTTP = { ok: 200, bad_request: 400, not_found: 404 };
const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

function fail(res, label, error) {
  logToFile(`❌ Internal LP own ${label} failed`, { error: error && error.message }, 'error');
  return res.status(500).json({ success: false, error: 'internal_error' });
}

router.get('/lp612/own/shelf', requireInternalKey, async (req, res) => {
  const keys = require('../services/lp-own-mine').cleanKeys((req.query || {}).keys);
  if (!keys.length) return res.status(400).json({ success: false, error: 'bad_request' });
  try {
    return res.json({ success: true, plans: await require('../services/lp612-own-library').listShelf({ keys }) });
  } catch (error) {
    return fail(res, 'shelf', error);
  }
});

router.get('/lp612/own/review', requireInternalKey, async (_req, res) => {
  try {
    return res.json({ success: true, plans: await require('../services/lp612-own-approval').listQueue() });
  } catch (error) {
    return fail(res, 'review queue', error);
  }
});

router.post('/lp612/own/review/:ownId', requireInternalKey, async (req, res) => {
  const body = req.body || {};
  try {
    const out = await require('../services/lp612-own-approval').decide({
      ownId: str(req.params.ownId),
      reviewerId: str(body.reviewerId),
      decision: str(body.decision, 20),
      reason: typeof body.reason === 'string' ? body.reason : undefined,
    });
    if (out.outcome === 'ok') return res.json({ success: true, decision: out.decision });
    return res.status(HTTP[out.outcome] || 500).json({ success: false, error: out.outcome });
  } catch (error) {
    return fail(res, 'review decision', error);
  }
});

router.get('/lp612/own/review/:ownId/file', requireInternalKey, async (req, res) => {
  try {
    const key = await require('../services/lp612-own-approval').reviewKey(str(req.params.ownId));
    if (!key) return res.status(404).json({ success: false, error: 'not_found' });
    const { buildR2PublicUrl, getPresignedUrl } = require('../storage/r2');
    return res.json({ success: true, url: await getPresignedUrl(buildR2PublicUrl(key)) });
  } catch (error) {
    return fail(res, 'review file', error);
  }
});

module.exports = router;
