'use strict';
/**
 * bd-fmf24g.15 — teacher app v2: what she asked for that takes a while, kept on the server, so the strip of
 * "Being made", the ready banner and Home's "Ready for you" survive a refresh or a new device. Mounted at
 * /api/portal by dashboard/index.js (one line), beside portal.routes.js, so it shares the portal's CORS /
 * rate-limit / session stack.
 *
 *   GET  /api/portal/me/notices                → { success, items, now }  her papers and grades 6-12 lesson plans
 *   POST /api/portal/me/notices/:id/seen       she closed the banner (the X, or went to Home from it)
 *   POST /api/portal/me/notices/:id/opened     she opened it (or tapped a failed paper)
 *
 * `:id` is `paper:<request uuid>` or `lesson:<render uuid>`. The teacher is ALWAYS the session's user. Dark
 * unless portal_teacher_v2 is on for her (404, nothing asked). Rules in services/teacher-notices.service.js.
 * Nothing here sends a WhatsApp message.
 */

const express = require('express');
const supabase = require('../config/supabase');
const pool = require('../config/database');
const { isFlagEnabledForUser, PORTAL_TEACHER_V2_KEY } = require('../lib/feature-flags');
const Notices = require('../services/teacher-notices.service');

const router = express.Router();
const dbQuery = (sql, params) => pool.query(sql, params);

// Self-contained duplicate of portal.routes.js's guard (not exported there), as the other teacher modules do.
function requirePortalAuth(req, res, next) {
  if (!req.session || !req.session.portalUserId) {
    return res.status(401).json({ success: false, error: 'Not authenticated. Please log in.' });
  }
  return next();
}

async function requireTeacherV2(req, res, next) {
  let on = false;
  try {
    on = await isFlagEnabledForUser(supabase, PORTAL_TEACHER_V2_KEY, req.session.portalUserId);
  } catch (error) {
    on = false; // a failed read is OFF, as every flag read is
  }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

const STATUS = { BAD_ID: 400, NOT_FOUND: 404 };

router.get('/me/notices', requirePortalAuth, requireTeacherV2, async (req, res) => {
  try {
    const { items } = await Notices.listNotices(dbQuery, req.session.portalUserId);
    return res.json({ success: true, items, now: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Portal me/notices failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not load what is being made. Please try again.' });
  }
});

function report(name, run) {
  return async (req, res) => {
    try {
      const out = await run(dbQuery, req.session.portalUserId, String((req.params && req.params.id) || ''));
      if (!out.ok) return res.status(STATUS[out.code] || 400).json({ success: false, code: out.code });
      return res.json({ success: true });
    } catch (error) {
      console.error(`❌ Portal me/notices ${name} failed`, { error: error && error.message });
      return res.status(502).json({ success: false, error: 'Could not save that. Please try again.' });
    }
  };
}

router.post('/me/notices/:id/seen', requirePortalAuth, requireTeacherV2, report('seen', Notices.markSeen));
router.post('/me/notices/:id/opened', requirePortalAuth, requireTeacherV2, report('opened', Notices.markOpened));

module.exports = router;
