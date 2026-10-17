'use strict';
/**
 * The edge routers dashboard/index.js mounts as one block, in this order: one line per feature, kept in name order, so
 * a new edge adds one line here instead of an app.use at a shared anchor. A line belongs here only when its router
 * holds routes only, on paths no other line shares, and falls through (next()) while its switch is off — the order
 * in this list then never decides who answers (tests/setup/edge-mounts.test.js).
 *
 *   [name, module in this folder, factory]   → app.use(require(module)[factory]())
 */
module.exports = Object.freeze([
  ['quiz-go', 'quiz-go.routes', 'createQuizGoRouter'],         // the one door: /quiz/go/:token, /api/go/* (quiz_one_door, decided by the bot)
  ['quiz-join', 'quiz-join.routes', 'createQuizJoinRouter'],   // a child joins on their own: /quiz/join/:token (quiz_student_join, decided by the bot)
].map(Object.freeze));
