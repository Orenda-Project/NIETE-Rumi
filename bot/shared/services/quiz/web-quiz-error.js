'use strict';
/**
 * The web quiz's error: {status, body}; the router turns it into the response. Its own module so a helper
 * (web-quiz-db-deadline) can throw it without requiring web-quiz.service, which requires the helper.
 * web-quiz.service re-exports it as WqError, so `instanceof WebQuiz.WqError` is unchanged.
 */
class WqError extends Error {
  constructor(status, body) {
    super(body && body.error ? body.error : `web quiz ${status}`);
    this.status = status;
    this.body = body;
  }
}

module.exports = { WqError };
