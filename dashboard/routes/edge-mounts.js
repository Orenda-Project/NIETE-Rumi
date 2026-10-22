'use strict';
/**
 * The edge routers dashboard/index.js mounts as one block, in this order: one line per feature, kept in name order, so
 * a new edge adds one line here instead of an app.use at a shared anchor. A line belongs here only when its router
 * holds routes only, on paths no other line shares, and falls through (next()) while its switch is off — the order
 * in this list then never decides who answers (tests/setup/edge-mounts.test.js, tests/edge-mounts-order.service.test.js).
 *
 *   [name, module in this folder, factory]   → app.use(require(module)[factory]())
 */
module.exports = Object.freeze([
  ['first-touch', 'first-touch.routes', 'createFirstTouchRouter'], // the maker page: /m/:token, /f/:token, /api/ft/* (quiz_maker_page)
  ['quiz-go', 'quiz-go.routes', 'createQuizGoRouter'],         // the one door: /quiz/go/:token, /api/go/* (quiz_one_door, decided by the bot)
  ['quiz-join', 'quiz-join.routes', 'createQuizJoinRouter'],   // a child joins on their own: /quiz/join/:token (quiz_student_join, decided by the bot)
  ['quiz-teacher', 'quiz-teacher.routes', 'createQuizTeacherRouter'], // the teacher home: /quiz/teacher/:token(/send|/stories), /api/th/* (quiz_teacher_home)
  ['sa-game', 'sa-game.routes', 'createSaGameRouter'],       // the Big Test: /sa-game/:token, /sa-game/a|b/* (sa_game, decided by the bot)
].map(Object.freeze));
