/**
 * A periodic SQS visibility-timeout re-extension for a job whose true duration cannot be bounded
 * by a single up-front extendJobTimeout() call.
 *
 * bd-awqt3: `lp612_author` asked SQS for ONE 900s extension at the top of the job and never
 * again (workers/sqs-worker.js). The job's own hard timeout (`LP612_AUTHOR_TIMEOUT_MS`) only
 * bounds authoring+render inside lp612-author.worker.js's `withTimeout()` — the PDF read, both
 * R2 uploads, the DB writes and the per-waiter WhatsApp delivery loop all run AFTER that timeout
 * and are unbounded. A load test measured jobs running past 936s: 36s past the one-shot 900s
 * window. Once the message goes visible again mid-run, a second worker claims the same lesson,
 * duplicate authoring doubles the load, and contention gets worse under exactly the load that
 * caused the overrun in the first place.
 *
 * A heartbeat removes the bet on a single number entirely: it keeps visibility ahead of the job
 * for as long as it is ACTUALLY running, however long that turns out to be, and stops the moment
 * the job settles.
 *
 * Contract:
 *  - re-extends every `intervalMs` by `extendSeconds`, for as long as `stop()` has not been
 *    called;
 *  - `stop()` MUST be called from the job's own finally-block, on every exit path (success AND
 *    failure). A leaked interval keeps re-extending visibility for a message whose job already
 *    finished, which starves every other job waiting behind it and is caught by
 *    `jest.useFakeTimers()` + `getActiveTimers` style teardown checks in tests, but has no such
 *    safety net in production — hence the ceiling below;
 *  - a single failed `extend()` call is reported via `onExtendError` and swallowed, never thrown
 *    — an SQS blip is not a reason to abandon a lesson the teacher is waiting for. (Contrast with
 *    the up-front `extendJobTimeout()` call the caller makes before starting this heartbeat,
 *    which is unchanged and still throws on failure — that call happens once, before any real
 *    work, and a failure there means the job should not start at all.)
 *  - bounded by `ceilingMs`: once the heartbeat has been running for that long it stops
 *    extending on its own (`onCeilingReached` fires once), so a job that is genuinely hung
 *    eventually becomes visible again for a fresh worker instead of an interval keeping a corpse
 *    invisible forever. Callers should pick a ceiling that is a firm multiple of the job's own
 *    hard timeout, never "forever".
 *
 * Deliberately generic (no lp612-specific naming) so another long job can adopt it later, but as
 * of this change it has exactly ONE caller: the `lp612_author` case in workers/sqs-worker.js. No
 * other job type's behaviour changes.
 */

function startVisibilityHeartbeat({
  extend,
  intervalMs = 60 * 1000,
  extendSeconds = 900,
  ceilingMs = null,
  onExtendError = () => {},
  onCeilingReached = () => {},
} = {}) {
  if (typeof extend !== 'function') {
    throw new Error('startVisibilityHeartbeat requires an `extend(seconds)` function');
  }

  const startedAt = Date.now();
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;

    if (ceilingMs != null && (Date.now() - startedAt) >= ceilingMs) {
      stopped = true;
      clearInterval(timer);
      try {
        onCeilingReached();
      } catch (_) {
        // onCeilingReached is caller-supplied logging; it must never be able to affect the job.
      }
      return;
    }

    Promise.resolve()
      .then(() => extend(extendSeconds))
      .catch((err) => {
        try {
          onExtendError(err);
        } catch (_) {
          // Same reasoning as above: a logging callback must never throw into the interval.
        }
      });
  }, intervalMs);
  if (timer.unref) timer.unref();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = { startVisibilityHeartbeat };
