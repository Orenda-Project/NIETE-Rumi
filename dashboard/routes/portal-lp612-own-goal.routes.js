'use strict';
/**
 * bd-snkn32.56 (queue #134 E) — "Make my own": start from a learning goal or topic (no textbook in class). Two reads for
 * the form's step 1, grades 6-12; Make my plan itself is the same POST /lp612/own with `answers.goal` (the bot checks
 * the switch again). Mounted at /api/portal beside portal-lp612-own.routes.js.
 *
 *   GET /api/portal/lp612/own/goals?grade&subject          → { success, outcomes: [{ segmentId, text, chapter }] }
 *   GET /api/portal/lp612/own/goals/match?grade&subject&q  → { success, match: { segmentId, title } | null }
 *
 * Dark (404) unless the teacher app, portal_lp_make_own AND the LIST-ONLY portal_lp_own_goal_start are on for her, and
 * she is not a GB teacher. The user is always the session's. Rows are read with this server's client through the bot's
 * own store (lp612-own-goal.store), so the form and the bot read one catalogue the same way.
 */
const express = require('express');
const supabase = require('../config/supabase');
const { PORTAL_TEACHER_V2_KEY, PORTAL_LP_MAKE_OWN_KEY, isFlagEnabledForUser } = require('../lib/feature-flags');
const { isGbTeacher } = require('../../bot/shared/services/lp-own-gb');
const { teacherAppOnFor } = require('../lib/teacher-app');
const { requirePortalAuth } = require('../lib/portal-auth');
const { goalStartOn, goalRows } = require('../../bot/shared/services/lp612-own-goal.store');
const { outcomeList, matchTopic, outcomeOf } = require('../../bot/shared/services/lp612-own-goal');

const router = express.Router();
const SUBJECT_MAX = 80;
const Q_MAX = 120;

async function requireGoalStart(req, res, next) {
  const userId = req.session.portalUserId;
  let on = false;
  try {
    on = (await teacherAppOnFor(supabase, PORTAL_TEACHER_V2_KEY, userId))
      && (await isFlagEnabledForUser(supabase, PORTAL_LP_MAKE_OWN_KEY, userId))
      && (await goalStartOn(supabase, userId))
      && !(await isGbTeacher(supabase, userId));
  } catch (_) { on = false; }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

/** grade 6-12 and a subject, from the query; null when either is missing or off the band. */
function gradeSubject(q) {
  const grade = Number(q.grade);
  const subject = typeof q.subject === 'string' ? q.subject.trim().slice(0, SUBJECT_MAX) : '';
  return Number.isInteger(grade) && grade >= 6 && grade <= 12 && subject ? { grade, subject } : null;
}

router.get('/lp612/own/goals', requirePortalAuth, requireGoalStart, async (req, res) => {
  const at = gradeSubject(req.query || {});
  if (!at) return res.status(400).json({ success: false, error: 'grade 6-12 and subject are required' });
  try {
    return res.json({ success: true, outcomes: outcomeList(await goalRows(supabase, at)) });
  } catch (error) {
    console.error('❌ Portal lp612/own/goals failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not read the outcomes' });
  }
});

router.get('/lp612/own/goals/match', requirePortalAuth, requireGoalStart, async (req, res) => {
  const at = gradeSubject(req.query || {});
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, Q_MAX) : '';
  if (!at || !q) return res.status(400).json({ success: false, error: 'grade 6-12, subject and q are required' });
  try {
    const hit = matchTopic(q, await goalRows(supabase, at));
    return res.json({ success: true, match: hit ? { segmentId: hit.segment_id, title: outcomeOf(hit) } : null });
  } catch (error) {
    console.error('❌ Portal lp612/own/goals/match failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not match the topic' });
  }
});

module.exports = router;
