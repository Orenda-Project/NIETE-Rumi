/**
 * bd-2386 — Leader "My Patch" overview.
 *
 * Pure aggregation over getPatchTeachers' output (no new DB round-trip). Produces
 * the KPIs the My Patch home shows and a "focus list" (on-Rumi teachers with the
 * lowest recent scores — where the leader's attention is most useful). Averages
 * only teachers who actually have a score, so a big un-coached patch never drags
 * the headline to zero.
 */

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {object[]} teachers  output of getPatchTeachers
 * @param {{focusLimit?: number}} [opts]
 */
function summarizePatch(teachers, opts = {}) {
  const list = Array.isArray(teachers) ? teachers : [];
  const focusLimit = opts.focusLimit || 5;

  const scored = list.filter((t) => t.lastScore != null);
  const avgLastScore = scored.length
    ? round1(scored.reduce((sum, t) => sum + t.lastScore, 0) / scored.length)
    : null;

  // Lowest score first — where coaching attention pays off most.
  const focus = [...scored]
    .sort((a, b) => a.lastScore - b.lastScore)
    .slice(0, focusLimit);

  return {
    totalTeachers: list.length,
    onRumi: list.filter((t) => t.onRumi).length,
    notOnRumi: list.filter((t) => !t.onRumi).length,
    totalCoachingSessions: list.reduce((n, t) => n + (t.coachingSessions || 0), 0),
    totalLessonPlans: list.reduce((n, t) => n + (t.lessonPlans || 0), 0),
    // the landing view is organised by feature, so every feature
    // needs a patch-wide number and not only a per-teacher one.
    totalAttendanceSessions: list.reduce((n, t) => n + (t.attendanceSessions || 0), 0),
    totalTrainingModules: list.reduce((n, t) => n + (t.trainingModules || 0), 0),
    // REACH, which is the more honest of the two figures on this view: 21
    // registers across 19 teachers reads as a healthy school right up until you
    // learn that one teacher took all 21. A total cannot show that; a count of
    // who has touched the feature at all can.
    teachersMarkingAttendance: list.filter((t) => (t.attendanceSessions || 0) > 0).length,
    teachersInTraining: list.filter((t) => (t.trainingModules || 0) > 0).length,
    scoredTeachers: scored.length,
    avgLastScore,
    focus,
  };
}

module.exports = { summarizePatch };
