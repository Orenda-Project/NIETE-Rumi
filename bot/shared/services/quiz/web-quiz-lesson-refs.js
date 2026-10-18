'use strict';
/**
 * A quiz's lesson references: the lesson plan or the coaching session it was made from, as 'lp:<id>' / 'cs:<id>'.
 * A leaf module (no requires), so the hub and the class table's twin lookup share one rule without a require cycle.
 */
const lessonRefs = (q) => [q && q.lesson_plan_id && `lp:${q.lesson_plan_id}`, q && q.coaching_session_id && `cs:${q.coaching_session_id}`].filter(Boolean);

module.exports = { lessonRefs };
