'use strict';
/**
 * bd-snkn32 — "Make my own" lesson plan, from the teacher app. Mounted at /api/portal by dashboard/index.js beside the
 * other teacher modules (portal-share.routes.js's pattern).
 *
 *   POST /api/portal/lp612/own  { segment_id, answers: { size, resources, level, way, note } }
 *     → 202 { success, state: 'authoring', renderId }   her fork's id, polled on the SAME /lp612/status/:id and
 *                                                        /lp612/file/:id as any 6-12 lesson (the bot answers it)
 *
 * Dark unless portal_teacher_v2 AND portal_lp_make_own are on for her: 404, the bot never asked. The user is ALWAYS
 * the session's. The bot holds every rule (codes checked, shared plan asked for, fork queued); this only passes on its
 * answer. A bot that cannot be reached is 502, never a plan.
 */
const express = require('express');
const supabase = require('../config/supabase');
const { PORTAL_TEACHER_V2_KEY, PORTAL_LP_MAKE_OWN_KEY, isFlagEnabledForUser } = require('../lib/feature-flags');
const { teacherAppOnFor } = require('../lib/teacher-app');
const { requirePortalAuth } = require('../lib/portal-auth');

const router = express.Router();
const PASS_ON = new Set([400, 403, 404]);

async function requireMakeOwn(req, res, next) {
  const userId = req.session.portalUserId;
  let on = false;
  try {
    on = (await teacherAppOnFor(supabase, PORTAL_TEACHER_V2_KEY, userId))
      && (await isFlagEnabledForUser(supabase, PORTAL_LP_MAKE_OWN_KEY, userId));
  } catch (_) { on = false; }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

router.post('/lp612/own', requirePortalAuth, requireMakeOwn, async (req, res) => {
  const b = req.body || {};
  const segmentId = typeof b.segment_id === 'string' ? b.segment_id.trim() : '';
  if (!segmentId || segmentId.length > 200 || !b.answers || typeof b.answers !== 'object' || Array.isArray(b.answers)) {
    return res.status(400).json({ success: false, error: 'segment_id and answers are required' });
  }
  try {
    const axios = require('axios');
    const baseUrl = (process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
    const apiKey = process.env.INTERNAL_API_KEY || '';
    if (!baseUrl || !apiKey) throw new Error('LP 6-12 API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
    const r = await axios.post(`${baseUrl}/api/internal/lp612/own`, {
      userId: req.session.portalUserId, segmentId, answers: b.answers,
    }, { headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 20000, validateStatus: () => true });
    if (r.status === 202 && r.data && r.data.success && r.data.renderId) {
      return res.status(202).json({ success: true, state: 'authoring', renderId: r.data.renderId });
    }
    if (PASS_ON.has(r.status)) return res.status(r.status).json({ success: false, error: 'Could not make that plan' });
    throw new Error(`lp612/own failed (HTTP ${r.status})`);
  } catch (error) {
    console.error('❌ Portal lp612/own failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not make your plan' });
  }
});

module.exports = router;
