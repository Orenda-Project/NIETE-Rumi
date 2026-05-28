/**
 * OECD score adapter — goal altitude (5 groups).
 *
 * Mirrors the hero report's 6-row grid; goal-altitude is the cleanest fit
 * (criterion altitude is 17 rows, too dense for a mobile hero). The
 * pre-rolled `analysis.scores.goalN_total` marks are the source of truth;
 * each goal's max = sum of criterion `max_marks` from the rubric.
 */

const oecdFramework = require('../../frameworks/oecd-framework');

const GOAL_DISPLAY = {
  goal1_formative_assessment: { key: 'G1', name: 'Formative Assessment & Feedback' },
  goal2_student_engagement:   { key: 'G2', name: 'Student Engagement' },
  goal3_quality_content:      { key: 'G3', name: 'Quality Subject Content' },
  goal4_classroom_interaction: { key: 'G4', name: 'Classroom Interaction' },
  goal5_classroom_management: { key: 'G5', name: 'Classroom Management' },
};

function buildOecdGroups(a) {
  const RUBRIC = oecdFramework.getScoringConstants().areas;
  const scores = (a && a.scores) || {};
  return Object.entries(GOAL_DISPLAY).map(([goalKey, def]) => {
    const criteria = RUBRIC[goalKey] || {};
    const max = Object.values(criteria).reduce((s, c) => s + (c.max_marks || 0), 0);
    // goal_key looks like `goal1_formative_assessment`; the persisted score key is
    // `goal1_total` (i.e. the prefix before the first underscore + `_total`).
    const shortKey = goalKey.split('_')[0]; // 'goal1'
    const score = Number(scores[`${shortKey}_total`]) || 0;
    return { key: def.key, name: def.name, score, max, pct: max > 0 ? Math.round((score / max) * 100) : 0 };
  });
}

module.exports = { buildOecdGroups };
