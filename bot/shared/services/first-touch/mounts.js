'use strict';
/**
 * The optional first-touch mounts bot/whatsapp-bot.js runs as one block, in this order: one line per feature, kept in
 * name order, so a new one adds one line here instead of a try block at a shared anchor. Each mount path is its own
 * (tests/setup/edge-mounts.test.js), and each mount runs in its own try: one that throws costs only itself.
 *
 *   [name, module in this folder, mount function]   → require(module)[mount](app)
 */
module.exports = Object.freeze([
  ['go', 'go.mount', 'mountGo'],                                 // /api/internal/go (quiz_one_door: the /quiz/go landing, the one question)
  ['maker', 'maker.mount', 'mountMaker'],                        // /api/internal/ft (quiz_maker_page)
  ['sa-game', 'sa-game.mount', 'mountSaGame'],                   // /api/internal/sagame (sa_game: the big flight page; off → 404 {off:true} and the edge falls through)
  ['teacher-home', 'teacher-home.mount', 'mountTeacherHome'],    // /api/internal/th (quiz_teacher_home; off → 404 {off:true} and the edge falls through)
  ['teacher-home-portal', 'teacher-home.portal.mount', 'mountTeacherHomePortal'], // /api/internal/thportal (quiz_teacher_home: the teacher app's home card)
].map(Object.freeze));
