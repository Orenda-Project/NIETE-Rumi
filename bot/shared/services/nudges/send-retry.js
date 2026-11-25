'use strict';
/**
 * A scheduled ask whose send never reached Meta gets another try (bd-6jaq0i).
 *
 * 24 Nov 2026, 10:08–10:10Z: 102 of the day's 308 15:00 LP quiz offers failed with `connect ENETUNREACH` to
 * Meta's address. No request left the worker, so no teacher got anything, and each row was marked failed for good.
 * A send that never connected is safe to repeat: it goes back to `pending`, due RETRY_MIN later, at most
 * MAX_RETRIES times. Anything Meta itself answered (an HTTP status) is NOT retried here: a 400 stays a 400.
 *
 * Kill switch: NUDGE_NET_RETRY=off|false|0|no is the behaviour before the fix (fail at once).
 * Pure: no I/O. The sweeper does the deferring; the handler decides whether to ask for it.
 */
const { onUnlessOff } = require('./flags');

const MAX_RETRIES = 2;
const RETRY_MIN = 10;
// Connection-level failures: the request never got an answer from Meta.
const UNREACHED = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);

/** True only for an error with no HTTP answer and a connection-level code (axios `code`, or fetch's `cause.code`). */
function isUnreached(error) {
  if (!error || error.response) return false;
  const code = error.code || (error.cause && error.cause.code);
  return UNREACHED.has(String(code || ''));
}

/**
 * The next try for this row, or null (switch off, not a network miss, or out of tries).
 * @returns {{at: Date, tries: number, code: string}|null}
 */
function nextTry(row, error, now = new Date()) {
  if (!onUnlessOff('NUDGE_NET_RETRY') || !isUnreached(error)) return null;
  const done = Number((row && row.context && row.context.net_retries) || 0);
  if (done >= MAX_RETRIES) return null;
  return {
    at: new Date(new Date(now).getTime() + RETRY_MIN * 60 * 1000),
    tries: done + 1,
    code: String(error.code || (error.cause && error.cause.code)),
  };
}

/** The error a handler throws to ask the sweeper for that try: it carries `retryAt` and the context to stamp. */
function retryError(message, next) {
  return Object.assign(new Error(message), {
    retryAt: next.at,
    retryContext: { net_retries: next.tries, net_error: next.code },
  });
}

module.exports = { isUnreached, nextTry, retryError, MAX_RETRIES, RETRY_MIN };
