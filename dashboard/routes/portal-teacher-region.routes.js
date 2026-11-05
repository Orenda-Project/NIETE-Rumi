'use strict';
/**
 * bd-rj6w0n.14.2 — the one-time ICT-or-GB choice on the teacher app's Lesson Plans page. Mounted at
 * /api/portal by dashboard/index.js (one line), on the portal's CORS / rate-limit / session stack.
 *
 *   GET  /api/portal/teacher/region   -> { success, region, ask, sectors, schools }
 *   POST /api/portal/teacher/region   { region: 'ict', sector } | { region: 'gb', schoolId? } -> { success, region, saved }
 *
 * Asked here, never on WhatsApp (every WhatsApp message costs money). Rules in services/teacher-region.service.js.
 * The teacher is ALWAYS the session's user. Dark (404, nothing read) unless LP_GB_K5_ENABLED is 'true'.
 */

const express = require('express');
const supabase = require('../config/supabase');
const { requirePortalAuth } = require('../lib/portal-auth');
const { isLpGbK5Enabled } = require('../../bot/shared/config/lp612-flags');
const TeacherRegion = require('../services/teacher-region.service');

const router = express.Router();

function requireGbFlag(req, res, next) {
  if (!isLpGbK5Enabled()) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

const failed = (res, err) => {
  console.error('❌ teacher region:', (err && err.message) || err);
  return res.status(502).json({ success: false, error: 'Unavailable' });
};

router.get('/teacher/region', requirePortalAuth, requireGbFlag, async (req, res) => {
  try {
    return res.json({ success: true, ...(await TeacherRegion.regionState(supabase, req.session.portalUserId)) });
  } catch (err) {
    return failed(res, err);
  }
});

router.post('/teacher/region', requirePortalAuth, requireGbFlag, async (req, res) => {
  try {
    const { status, body } = await TeacherRegion.saveChoice(supabase, req.session.portalUserId, req.body);
    return res.status(status).json(body);
  } catch (err) {
    return failed(res, err);
  }
});

module.exports = router;
