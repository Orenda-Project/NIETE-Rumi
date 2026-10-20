'use strict';
/**
 * The finish response's reminder field: {push_remind: true} while web_quiz_push_remind is on (and every push env is
 * set), else {} — so with the switch off the finish JSON is today's, byte for byte. Never throws.
 */
async function pushField() {
  try {
    return (await require('./web-quiz-push.service').switches()).remind ? { push_remind: true } : {};
  } catch (_) {
    return {};
  }
}

module.exports = { pushField };
