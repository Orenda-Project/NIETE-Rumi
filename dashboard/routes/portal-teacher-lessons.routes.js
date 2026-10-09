'use strict';
/**
 * bd-fmf24g.3 — teacher app v2: the Lesson Plans feature's routes, and the grade·subject pairs
 * every v2 feature's picker reads. Mounted at /api/portal by dashboard/index.js (one line), next
 * to portal.routes.js, so it shares the portal's CORS / rate-limit / session / link-scope stack.
 *
 *   GET /api/portal/me/grade-subjects[?feature=lessons|assessment]
 *       → { success, combos: [{ grade, gradeCode, subject, subjectKey, source[, featureKey, available] }] }
 *   GET /api/portal/lesson-plans/history?range=…[&prevFrom=&prevTo=][&grade=&subject=]
 *       → "All lesson plans": the four numbers, the period before, the trend, one row per plan
 *
 * The teacher is ALWAYS the session's user; there is no id parameter to trust. Rules in
 * services/grade-subjects.service.js; the subject spellings in services/subject-vocabulary.service.js.
 */

const express = require('express');
const pool = require('../config/database');
const GradeSubjects = require('../services/grade-subjects.service');
const LpHistory = require('../services/lp-history.service');
const LpCatalogue = require('../services/lp-catalogue.service');
const { resolveRange, RangeInputError } = require('../lib/pk-range');

const router = express.Router();
const dbQuery = (sql, params) => pool.query(sql, params);

// Self-contained duplicate of portal.routes.js's guard (not exported there), as
// attendance.routes.js and hcp.routes.js do.
function requirePortalAuth(req, res, next) {
  if (!req.session || !req.session.portalUserId) {
    return res.status(401).json({ success: false, error: 'Not authenticated. Please log in.' });
  }
  return next();
}

router.get('/me/grade-subjects', requirePortalAuth, async (req, res) => {
  const feature = req.query.feature ? String(req.query.feature) : null;
  if (feature && !GradeSubjects.FEATURES.includes(feature)) {
    return res.status(400).json({ success: false, error: `feature must be one of: ${GradeSubjects.FEATURES.join(', ')}` });
  }
  try {
    const userId = req.session.portalUserId;
    const { combos } = await GradeSubjects.gradeSubjects(userId, GradeSubjects.defaultDeps(dbQuery));
    const out = feature ? await GradeSubjects.withFeatureKeys(combos, GradeSubjects.catalogueFor(feature)) : combos;
    return res.json({ success: true, combos: out });
  } catch (error) {
    console.error('❌ Portal me/grade-subjects failed', { feature, error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not load your classes. Please try again.' });
  }
});

/** A YYYY-MM-DD that names a real calendar day, or null. */
function realDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * GET /api/portal/lesson-plans/history?range=…&from=&to=[&prevFrom=&prevTo=][&grade=&subject=]
 * → { success, range, previous, filter, kpis: { lessonPlans, classesCovered, sentOnWhatsapp,
 *     daysActive } (each { value, previous }), trend: { bucketDays, points }, items, total, truncated }
 *
 * "All lesson plans": the range is resolved as /progress resolves it (Pakistan days, default this
 * month). prevFrom/prevTo, when sent, are the client's own period before (so the numbers match the
 * "vs …" it shows); otherwise the same stretch one step back. grade + subject (any spelling) narrow
 * the numbers and the list to one class. Rules in services/lp-history.service.js.
 */
router.get('/lesson-plans/history', requirePortalAuth, async (req, res) => {
  const bad = (error) => res.status(400).json({ success: false, error });
  let range;
  try {
    range = resolveRange(req.query);
  } catch (error) {
    if (error instanceof RangeInputError) return bad(error.message);
    throw error;
  }

  const { prevFrom, prevTo, grade, subject } = req.query;
  let previous;
  if (prevFrom !== undefined || prevTo !== undefined) {
    const from = realDate(prevFrom); const to = realDate(prevTo);
    if (!from || !to) return bad('prevFrom and prevTo must both be YYYY-MM-DD dates');
    if (from > to) return bad('prevFrom must be on or before prevTo');
    previous = { from, to };
  }

  let filter = null;
  if (grade !== undefined || subject !== undefined) {
    const g = grade === undefined || grade === '' ? null : Number(grade);
    if (g !== null && !(Number.isInteger(g) && g >= 1 && g <= 12)) return bad('grade must be 1 to 12');
    filter = { grade: g, subject: typeof subject === 'string' && subject.trim() ? subject : null };
  }

  try {
    const out = await LpHistory.lpHistory(dbQuery, req.session.portalUserId, {
      range, previous, filter, describe: LpCatalogue.describePlans,
    });
    return res.json({ success: true, range, ...out });
  } catch (error) {
    // Plans are named by the bot: unreachable is a 502 she can retry, never unnamed rows.
    console.error('❌ Portal lesson-plans/history failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not load your lesson plans' });
  }
});

module.exports = router;
