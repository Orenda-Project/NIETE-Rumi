'use strict';
/**
 * bd-fmf24g.4 — teacher app v2: Digital Coaching + Observations reads. Mounted at /api/portal by
 * dashboard/index.js (one line), beside portal.routes.js, so it shares the portal's CORS /
 * rate-limit / session / link-scope stack.
 *
 *   GET /api/portal/teacher/visits
 *       → { success, next: { date, slot, coachName, schoolName } | null,
 *           inProgress: [{ sessionId, date, coachName, stage: 'reviewing'|'debrief'|'report' }] }
 *   GET /api/portal/teacher/coaching/:id/journey
 *       → { success, points: [{ date, pct }] }   (404 when the session is not hers)
 *   GET /api/portal/teacher/coaching/history?range=…[&from=&to=][&prevFrom=&prevTo=]
 *       → { success, range, previous, kpis: { sessions, minutes, reports } (each { value, previous }),
 *           trend: { bucketDays, points }, items, total, truncated }
 *   GET /api/portal/teacher/coaching/:id/quiz-block
 *       → { success, mode: 'inline' | 'page', url: '/cq/<token>?embed=portal' | '/cq/<token>?from=portal' }
 *         The "Make a quiz" block on the teacher's report screen (bd-kcv8s5). 404 { off: true } with quiz_portal_report_block
 *         off or unreadable (the screen keeps today's quiz button); 404 when the lesson is not the teacher's, not ready, or a
 *         coach's visit. The link lasts a day and is never logged.
 *
 * The teacher is ALWAYS the session's user; there is no user id parameter to trust. Dark unless
 * portal_teacher_v2 is on for her: off answers 404, the same as a path that does not exist, and
 * nothing is read. Rules in services/teacher-coaching.service.js.
 */

const express = require('express');
const pool = require('../config/database');
const supabase = require('../config/supabase');
const { PORTAL_TEACHER_V2_KEY } = require('../lib/feature-flags');
// bd-33wxxi.1 — the teacher-app switches go through one gate: a principal on the principal app is on too.
const { teacherAppOnFor } = require('../lib/teacher-app');
const TeacherCoaching = require('../services/teacher-coaching.service');
const { resolveRange, RangeInputError, pkToday } = require('../lib/pk-range');

const router = express.Router();
const dbQuery = (sql, params) => pool.query(sql, params);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The portal's one sign-in check (lib/portal-auth.js): it also ends the session of a retired account.
const { requirePortalAuth } = require('../lib/portal-auth');

async function requireTeacherV2(req, res, next) {
  let on = false;
  try {
    on = await teacherAppOnFor(supabase, PORTAL_TEACHER_V2_KEY, req.session.portalUserId);
  } catch (error) {
    on = false; // a failed read is OFF, as every flag read is
  }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

/** A YYYY-MM-DD that names a real calendar day, or null. */
function realDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

router.get('/teacher/visits', requirePortalAuth, requireTeacherV2, async (req, res) => {
  const userId = req.session.portalUserId;
  try {
    const [next, inProgress] = await Promise.all([
      TeacherCoaching.nextVisit(dbQuery, userId, { today: pkToday() }),
      TeacherCoaching.visitsInProgress(dbQuery, userId),
    ]);
    return res.json({ success: true, next, inProgress });
  } catch (error) {
    // "No visit" is a real answer; a failed read must not be dressed up as one.
    console.error('❌ Portal teacher/visits failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not load your visits. Please try again.' });
  }
});

router.get('/teacher/coaching/:id/journey', requirePortalAuth, requireTeacherV2, async (req, res) => {
  const id = String(req.params.id || '');
  if (!UUID.test(id)) return res.status(404).json({ success: false, error: 'Session not found' });
  try {
    const points = await TeacherCoaching.journey(dbQuery, req.session.portalUserId, id);
    if (!points) return res.status(404).json({ success: false, error: 'Session not found' });
    return res.json({ success: true, points });
  } catch (error) {
    console.error('❌ Portal teacher/coaching journey failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not load your journey' });
  }
});

router.get('/teacher/coaching/history', requirePortalAuth, requireTeacherV2, async (req, res) => {
  const bad = (error) => res.status(400).json({ success: false, error });
  let range;
  try {
    range = resolveRange(req.query);
  } catch (error) {
    if (error instanceof RangeInputError) return bad(error.message);
    throw error;
  }

  const { prevFrom, prevTo } = req.query;
  let previous;
  if (prevFrom !== undefined || prevTo !== undefined) {
    const from = realDate(prevFrom); const to = realDate(prevTo);
    if (!from || !to) return bad('prevFrom and prevTo must both be YYYY-MM-DD dates');
    if (from > to) return bad('prevFrom must be on or before prevTo');
    previous = { from, to };
  }

  try {
    const out = await TeacherCoaching.dcHistory(dbQuery, req.session.portalUserId, { range, previous });
    return res.json({ success: true, range, ...out });
  } catch (error) {
    console.error('❌ Portal teacher/coaching/history failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not load your lessons' });
  }
});

// The report link for the block: one day, minted per view (the /cr link sent on WhatsApp lasts 120 days).
const QUIZ_BLOCK_TTL_S = 24 * 60 * 60;

router.get('/teacher/coaching/:id/quiz-block', requirePortalAuth, requireTeacherV2, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const id = String(req.params.id || '');
  if (!UUID.test(id)) return res.status(404).json({ success: false });
  let block;
  try {
    block = await require('../../bot/shared/services/quiz/report-page-quiz').fetchPortalBlock(supabase); // eslint-disable-line global-require
  } catch (error) {
    block = null; // a failed read is OFF, as every switch read is
  }
  if (!block || !block.on) return res.status(404).json({ success: false, off: true });
  const userId = req.session.portalUserId;
  try {
    const { data: session, error } = await supabase.from('coaching_sessions')
      .select('id, user_id, status, observation_type').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message || 'coaching_sessions read failed');
    // the teacher's own, ready, and their own recording (a coach's visit has no quiz block, as the screen draws none)
    if (!session || session.user_id !== userId || session.status !== 'completed' || session.observation_type) {
      return res.status(404).json({ success: false });
    }
  } catch (error) {
    console.error('❌ Portal teacher/coaching quiz-block failed', { error: error && error.message });
    return res.status(502).json({ success: false });
  }
  const token = require('../../bot/shared/services/coaching/report-link-token').signReportLink({ sessionId: id, userId }, { ttlS: QUIZ_BLOCK_TTL_S }); // eslint-disable-line global-require
  if (!token) return res.status(404).json({ success: false, off: true });
  const url = `/cq/${token}?${block.mode === 'page' ? 'from' : 'embed'}=portal`;
  return res.json({ success: true, mode: block.mode, url });
});

module.exports = router;
