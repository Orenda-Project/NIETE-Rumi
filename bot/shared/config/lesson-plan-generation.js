'use strict';
/**
 * The queued (grounded) lesson-plan render's attempt limit — ONE number for the three places that
 * must agree on it: the worker stops retrying and apologises at it, the queue service marks the
 * failure that reaches it as final, and the health check counts a failure below it as still in
 * flight (the queue will try again).
 */
module.exports = Object.freeze({
  MAX_ATTEMPTS: 3,
});
