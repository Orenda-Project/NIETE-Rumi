'use strict';
/**
 * bd-fmf24g.30 — POST /api/internal/share/send { userId, kind, id } → { success, status, at?|reason? }. Thin: the rules live
 * in services/share-send.service.js. Mounted from internal-api.routes.js (router.use), like internal-attendance.routes.js.
 * userId is the portal SESSION's user; the portal never takes it from its own request.
 *
 *   sent / unavailable / failed  → 200, the REAL result in `status` (the app shows each differently)
 *   not_found                    → 404     bad_request → 400
 */
const express = require('express');
const { logToFile } = require('../utils/logger');
const { requireInternalKey } = require('../middleware/require-internal-key');

const router = express.Router();
const HTTP = { sent: 200, unavailable: 200, failed: 200, not_found: 404, bad_request: 400 };

router.post('/share/send', requireInternalKey, async (req, res) => {
  const body = req.body || {};
  try {
    const out = await require('../services/share-send.service').sendShare({
      userId: String(body.userId || '').trim(), kind: String(body.kind || ''), id: String(body.id || ''),
    });
    return res.status(HTTP[out.status] || 500).json({ success: out.status !== 'not_found' && out.status !== 'bad_request', ...out });
  } catch (error) {
    logToFile('❌ Internal share send failed', { error: error && error.message }, 'error');
    return res.status(500).json({ success: false, status: 'failed', reason: 'error' });
  }
});

// Which kinds this deployment can send (a template is configured): the app greys the button for the rest.
router.post('/share/availability', requireInternalKey, (req, res) => (
  res.json({ success: true, kinds: require('../services/share-send.service').availability() })
));

module.exports = router;
