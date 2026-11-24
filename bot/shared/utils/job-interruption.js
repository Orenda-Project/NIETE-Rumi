/**
 * Is this job being cut off from outside, and should it simply run again?
 *
 * Two facts a queued job cannot see on its own:
 *
 *   1. This worker is shutting down. The SQS worker raises the flag the moment SIGTERM arrives
 *      (markShuttingDown), so job code can tell "the process is going away" from "my work failed".
 *   2. The failure was a dropped connection, not a wrong answer. undici reports the far side closing
 *      the socket mid-reply as `TypeError: terminated`, with the socket error on `cause`.
 *
 * Either one means the work never got a fair chance. Reporting it to the teacher as a failure ("please
 * try again") is wrong twice over: SQS delivers the same job again anyway, and she then gets her report
 * after being told it failed. NIETE production, 24 Nov 2026: exactly that, 15 minutes apart.
 *
 * `retryReason` decides. A cut-off job is handed back while the queue still has attempts left
 * (ApproximateReceiveCount below the redrive policy's maxReceiveCount, 3 on NIETE's coaching queue); the
 * last attempt fails exactly as before, so a job that never succeeds still ends with the teacher told.
 * Anything cut off while this worker is shutting down is handed back whatever the count says, because the
 * next attempt runs on a replica that is not.
 */

let shuttingDown = false;

function markShuttingDown() {
  shuttingDown = true;
}

function isShuttingDown() {
  return shuttingDown;
}

/** Test seam: the flag is process-wide. */
function _resetForTests() {
  shuttingDown = false;
}

const TRANSPORT_CODES = new Set([
  'ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ETIMEDOUT',
  'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'UND_ERR_ABORTED',
]);
const TRANSPORT_MESSAGES = [/^terminated$/i, /socket hang up/i, /other side closed/i, /^read ECONNRESET$/i];

/**
 * A dropped connection or an aborted request, never our own bad request, a model's bad reply, or a
 * timeout (the SDK has already spent its retries on a timeout). Walks `cause` a few levels, because
 * undici wraps the socket error.
 */
function isTransportAbort(err) {
  let e = err;
  for (let depth = 0; e && depth < 4; depth += 1, e = e.cause) {
    if (typeof e !== 'object') return false;
    if (e.name === 'AbortError') return true;
    if (e.code && TRANSPORT_CODES.has(String(e.code))) return true;
    const msg = String(e.message || '');
    if (TRANSPORT_MESSAGES.some((re) => re.test(msg))) return true;
  }
  return false;
}

/** NIETE's coaching queue: RedrivePolicy maxReceiveCount 3 (rumi-coaching-dlq-niete.fifo). */
function maxReceives() {
  const n = parseInt(process.env.SQS_MAX_RECEIVE_COUNT, 10);
  return Number.isInteger(n) && n > 0 ? n : 3;
}

/**
 * 'shutdown' | 'transport' | null — why this failed job should go back on the queue instead of failing.
 * @param {Error} err
 * @param {{receiveCount?: number}} [job]  how many times SQS has delivered this message (unknown → null)
 */
function retryReason(err, job = {}) {
  if (!isTransportAbort(err)) return null;
  if (isShuttingDown()) return 'shutdown';
  const count = Number(job && job.receiveCount);
  if (Number.isInteger(count) && count > 0 && count < maxReceives()) return 'transport';
  return null;
}

module.exports = { markShuttingDown, isShuttingDown, isTransportAbort, retryReason, maxReceives, _resetForTests };
