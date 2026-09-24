'use strict';
/**
 * Kill switches for the /quiz menu changes — one per behaviour, read at CALL
 * time, DEFAULT ON. Unset (or anything else) keeps the behaviour; 'false',
 * '0', 'off' or 'no' puts back the old behaviour exactly, with no deploy.
 *
 *   QUIZ_BARE_TEXT_TO_MENU     every bare spelling of "quiz" opens the menu (text door,
 *                              the child's door, the 👎 reason windows, a child's join)
 *   QUIZ_MENU_HANDSET_ROUTING  a question waiting → stay in the quiz; a child → their
 *                              quizzes; a coach → their own menu
 *   QUIZ_MENU_LESSON_ROWS      lesson plans with no quiz yet are listed in /quiz and made
 *                              on a tap; the 15:00 offer claims each lesson once
 *   QUIZ_MENU_SOURCE_LABELS    every row says "From lesson plan" / "From transcript"
 */

const OFF = new Set(['false', '0', 'off', 'no']);

function on(name) {
  return !OFF.has(String(process.env[name] == null ? '' : process.env[name]).trim().toLowerCase());
}

module.exports = {
  bareTextToMenu: () => on('QUIZ_BARE_TEXT_TO_MENU'),
  handsetRouting: () => on('QUIZ_MENU_HANDSET_ROUTING'),
  lessonRows: () => on('QUIZ_MENU_LESSON_ROWS'),
  sourceLabels: () => on('QUIZ_MENU_SOURCE_LABELS'),
};
