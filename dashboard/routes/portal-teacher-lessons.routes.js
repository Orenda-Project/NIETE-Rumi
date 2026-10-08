'use strict';
/**
 * bd-fmf24g.3 — teacher app v2: the Lesson Plans feature's routes, and the grade·subject pairs
 * every v2 feature's picker reads. Mounted at /api/portal by dashboard/index.js (one line), next
 * to portal.routes.js, so it shares the portal's CORS / rate-limit / session / link-scope stack.
 *
 *   GET /api/portal/me/grade-subjects[?feature=lessons|assessment]
 *       → { success, combos: [{ grade, gradeCode, subject, subjectKey, source[, featureKey, available] }] }
 *
 * The teacher is ALWAYS the session's user; there is no id parameter to trust. Rules in
 * services/grade-subjects.service.js; the subject spellings in services/subject-vocabulary.service.js.
 */

const express = require('express');
const pool = require('../config/database');
const GradeSubjects = require('../services/grade-subjects.service');

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

module.exports = router;
