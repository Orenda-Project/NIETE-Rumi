'use strict';
/**
 * My journey — the teacher's own steps (plans opened, taught, DC observations, reports, tips, quizzes, papers), newest
 * first. Mounted at /api/portal by dashboard/index.js beside the other teacher modules.
 *
 *   GET /api/portal/me/journey → { success, ready:true, updatedAt, slot, steps:[{ kind, at, refId, meta }] }
 *                               | { success, ready:false }   (nothing stored yet, expired, or Redis down)
 *
 * The steps are counted twice a day by the worker on the read replica and kept in Redis (docs/teacher-activity-store.md);
 * this route reads the store ONLY — never the database, and a miss is "not ready yet", never a fallback read. The page
 * draws two weeks at a time from the one answer (no request per page).
 *
 * Guards: no session 401 → portal_teacher_journey off for her 404 (the store is not read). The user is ALWAYS the
 * session's: no id is taken from the query, the params or the body, so a teacher can never read another's journey.
 */
const express = require('express');
const supabase = require('../config/supabase');
const { requirePortalAuth } = require('../lib/portal-auth');
const { isTeacherJourneyOn } = require('../lib/lp-app-switches');
const { readTeacherActivity } = require('../services/teacher-activity-store');
const { journeySteps } = require('../services/teacher-journey-view.service');

const router = express.Router();

router.get('/me/journey', requirePortalAuth, async (req, res) => {
  const userId = req.session.portalUserId;
  let on = false;
  try { on = await isTeacherJourneyOn(supabase, userId); } catch (_) { on = false; }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  const value = await readTeacherActivity(userId);
  if (!value) return res.json({ success: true, ready: false });
  return res.json({ success: true, ready: true, updatedAt: value.updated_at, slot: value.slot, steps: journeySteps(value) });
});

module.exports = router;
