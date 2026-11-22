'use strict';
/**
 * The finish response's reminder field: {push_remind: true} while web_quiz_push_remind is on (and every push env is
 * set), else {} — so with the switch off the finish JSON is today's, byte for byte. The switch rides the hub switches'
 * one read (web-quiz-hub-flags.js, which the page's boot already made): no settings read on the finish path, on or off.
 * Cold or stale hub cache → {} (no card this time). Never throws.
 */
function pushField() {
  try {
    if (!require('../quiz/web-quiz-hub-flags').nowOf('pushRemind')) return {};
    return require('./web-quiz-push.service').envReady() ? { push_remind: true } : {};
  } catch (_) {
    return {};
  }
}

module.exports = { pushField };
