'use strict';
/**
 * v10 coaching test (bd-v0toag.8, PR2): the thing to try on the teacher app's lesson plan. Mounted
 * at /api/portal by dashboard/index.js (one line), on the portal's CORS / rate-limit / session stack.
 *
 *   GET  /api/portal/teacher/thing-to-try?lessonId=   → { success, thing: { text, tag, step } | null }
 *   POST /api/portal/teacher/thing-to-try/tap         { lessonId, step } → 204
 *
 * thing is null for everyone but groups C and D while ab_v10_enabled is on (rules in
 * services/thing-to-try.service.js). A shown strip and a tap go to Axiom with the group, the move
 * and the step. The teacher is ALWAYS the session's user. Dark (404) unless portal_teacher_v2 is
 * on for her, as the other teacher app reads.
 */

const express = require('express');
const supabase = require('../config/supabase');
const { isFlagEnabledForUser, PORTAL_TEACHER_V2_KEY } = require('../lib/feature-flags');
const ThingToTry = require('../services/thing-to-try.service');
const telemetry = require('../services/telemetry.service');

const router = express.Router();

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
    on = false;
  }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

function emit(event, userId, found, extra) {
  try {
    const { group, thing } = found;
    telemetry.logEvent(event, {
      userId, group, ...extra, moveId: thing.moveId, setOnLessonId: thing.setOnLessonId, tag: thing.tag,
    });
  } catch (_) { /* logging never decides the response */ }
}

router.get('/teacher/thing-to-try', requirePortalAuth, requireTeacherV2, async (req, res) => {
  const userId = req.session.portalUserId;
  const found = await ThingToTry.thingFor(supabase, userId);
  if (!found) return res.json({ success: true, thing: null });
  const { lessonId } = ThingToTry.cleanTap({ lessonId: req.query.lessonId });
  const step = found.thing.step || null;
  emit('coaching.thing_to_try.portal_shown', userId, found, { lessonId, step: step && step.index });
  return res.json({ success: true, thing: { text: found.thing.text, tag: found.thing.tag, step } });
});

router.post('/teacher/thing-to-try/tap', requirePortalAuth, requireTeacherV2, async (req, res) => {
  const userId = req.session.portalUserId;
  try {
    const found = await ThingToTry.thingFor(supabase, userId);
    if (found) emit('coaching.thing_to_try.tap', userId, found, ThingToTry.cleanTap(req.body));
  } catch (_) { /* a tap is never an error to her */ }
  return res.status(204).end();
});

module.exports = router;
