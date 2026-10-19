'use strict';
/**
 * The class-week sample window for the v2 serve: a class-link run inside its class's OPEN week is the 'class_week'
 * arm (web-quiz-challenge-draw.adminFields, required lazily there).
 *
 *   openWindowFor({ classId, at })  true only when the class's week this term is open at `at`
 *       ([week_start, week_end) of its class_round_draws row), false otherwise.
 *
 * One home for the window read: it delegates to teacher-class-week's openWeek(classId, termOf(at), at), the read the
 * Jugnu tab's "Forward the week" card uses, under the card's own switch (web-quiz-class-week-flags.classWeekOn:
 * web_quiz_class_week under its parents). Switch off → false with no class_round_draws read. Any error → false
 * (fail-safe: no arm). Writes nothing, logs nothing of its own.
 */
const { classWeekOn } = require('./web-quiz-class-week-flags');
const Week = require('./teacher-class-week');

async function openWindowFor({ classId, at = new Date() } = {}) {
  try {
    const now = at instanceof Date ? at.getTime() : Date.parse(at);
    if (!classId || !Number.isFinite(now)) return false;
    if (!(await classWeekOn())) return false;
    return Boolean(await Week.openWeek(classId, Week.termOf(now), now));
  } catch (_) {
    return false;
  }
}

module.exports = { openWindowFor };
