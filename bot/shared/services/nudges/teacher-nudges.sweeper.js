'use strict';
/**
 * The teacher-nudge core — the periodic half of the scheduled teacher asks.
 *
 * WHAT IT DOES, in order, once per tick: expire whatever is stuck in `sending`,
 * then for each REGISTERED kind — build that kind's cohort (`prepare`), claim
 * what is due, hand each claimed row to that kind's handler, mark the outcome —
 * and finally emit one line with the counts.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: send anything. It has no handlers of its
 * own. A kind that nobody registered is never claimed, so the schedule cannot
 * take a row that nothing in this process knows how to deliver — which is the
 * failure mode when two services load the same worker file and only one of them
 * carries the sender.
 *
 * Pre-merge Class P, clause by clause:
 *   P1 single-flight   rows arrive only from `store.claimDue`, which is a
 *                      conditional UPDATE returning what IT won. Two replicas
 *                      ticking in the same second each hold a disjoint set.
 *   P2 kill switch     TEACHER_NUDGES_ENABLED, read at CALL time. Unset or false
 *                      and the tick touches nothing at all — not even a read. A
 *                      flag flipped on Railway takes effect on the next tick.
 *   P3 per-tick cap    `limit` (default 200) is passed to the claim, per kind. A
 *                      backlog drips out over ticks; it never bursts.
 *   P4 one log line    exactly one `teacher_nudges.sweep` per tick with all its
 *                      counts, so an idle sweeper and a lock-starved one do not
 *                      look identical.
 *
 * ONE OPEN QUESTION AT A TIME. Before a claimed row reaches its handler, the
 * sweeper asks whether the teacher is still answering one of our surveys (a 👎
 * takes the next typed message as its reason for ten minutes — see
 * nudges/open-question). If so the row goes back to `pending`, due when that
 * window closes, and is counted `deferred`: a typed "yes" to an ask sent into the
 * window would be saved as the survey's answer. The rule lives here, not in a
 * handler, so every scheduled ask keeps it.
 *
 * NOTHING HERE THROWS. A sweeper that can throw takes the worker's interval with
 * it; every failure is caught, logged at error level, counted, and the tick
 * carries on to the next row and the next kind.
 */

const store = require('./teacher-nudges.store');
const { flagOn } = require('./flags');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

/** kind → { handler, prepare }. Insertion order is sweep order. */
const registry = new Map();

const VALID_KINDS = new Set(Object.values(store.KINDS));

/**
 * The master switch, read at call time and never cached (P2).
 *
 * Exported because `sqs-worker.js` gates the interval's REGISTRATION on the same
 * answer, and two copies of "what counts as on" is how a flag ends up half-set:
 * armed at boot, ignored per tick, or the reverse.
 */
function isEnabled() {
  return flagOn('TEACHER_NUDGES_ENABLED');
}

function logError(message, data) {
  logToFile(`❌ teacher_nudges sweep: ${message}`, data, 'error');
}

/**
 * Claim a kind for this process.
 *
 * @param {string} kind    one of `store.KINDS` — a kind outside the V1.5.3 CHECK
 *                         constraint could never have been inserted, so
 *                         registering one is a typo, caught here at load.
 * @param {Function} handler  `(row) => {sent:true, messageIds} | {skipped:reason}`;
 *                         it may throw, and a throw marks the row failed.
 * @param {Object} [opts]
 * @param {Function} [opts.prepare]  `({now}) => void`, run before the claim. Lane B
 *                         builds the day's cohort here. It MUST be idempotent and
 *                         cheap: it runs on every tick, on every replica.
 */
function register(kind, handler, { prepare } = {}) {
  if (!VALID_KINDS.has(kind)) {
    throw new Error(
      `teacher_nudges sweeper: cannot register unknown kind ${JSON.stringify(kind)} — `
      + `the table's CHECK allows ${[...VALID_KINDS].join(', ')}`,
    );
  }
  if (typeof handler !== 'function') {
    throw new Error(`teacher_nudges sweeper: handler for ${kind} must be a function`);
  }
  if (registry.has(kind)) {
    throw new Error(
      `teacher_nudges sweeper: ${kind} is already registered — two owners for one kind `
      + 'means two messages for one teacher',
    );
  }
  if (prepare !== undefined && typeof prepare !== 'function') {
    throw new Error(`teacher_nudges sweeper: prepare for ${kind} must be a function`);
  }
  registry.set(kind, { handler, prepare: prepare || null });
}

/**
 * One row, start to finish. Returns which counter to bump.
 *
 * `now` is the sweep's own clock, handed to the handler so its send-time checks
 * (the 24-hour window, "today") read the same instant the claim was made at —
 * not a second, later reading of the wall clock. A handler that ignores it reads
 * the real clock, as before.
 */
/**
 * The survey question this teacher still owes an answer, or null. Never throws:
 * the question is a courtesy, and a lookup that fails must not cost the ask.
 */
async function openQuestionFor(row, now) {
  try {
    const { openQuestion } = require('./open-question');
    return await openQuestion(row.user_id, { now });
  } catch (error) {
    logError('open-question check failed; sending as usual', { id: row.id, error: error.message });
    return null;
  }
}

async function handleRow(kind, row, handler, now) {
  try {
    const open = await openQuestionFor(row, now);
    if (open) {
      const handedBack = await store.defer(row.id, open.until, { deferred_for: open.kind });
      if (!handedBack) {
        // Still `sending`; expireStuck will call it failed. Said here so the two
        // are never confused with a handler that threw.
        logError('could not hand a deferred row back to pending', { kind, id: row.id });
        return 'failed';
      }
      logEvent('teacher_nudges.deferred', {
        kind,
        nudgeId: row.id,
        userId: row.user_id,
        openQuestion: open.kind,
        until: open.until.toISOString(),
      });
      return 'deferred';
    }

    const outcome = await handler(row, { now });

    if (outcome && outcome.sent) {
      const marked = await store.markSent(row.id, {
        messageIds: outcome.messageIds || [],
        context: outcome.context || {},
      });
      if (!marked) {
        // The teacher HAS the message; only the row failed to flip. Saying so is
        // the whole point — otherwise expireStuck will later call a delivered
        // nudge a failure and nobody will know which of the two happened.
        logError('sent but the row could not be marked sent', { kind, id: row.id });
      }
      return 'sent';
    }

    if (outcome && outcome.skipped) {
      await store.markSkipped(row.id, outcome.skipped, outcome.context || {});
      return 'skipped';
    }

    throw new Error(
      `handler for ${kind} returned ${JSON.stringify(outcome)} — expected {sent} or {skipped}`,
    );
  } catch (error) {
    logError('row failed', { kind, id: row.id, error: error.message });
    try {
      await store.markFailed(row.id, error);
    } catch (markError) {
      logError('could not even mark the row failed', { kind, id: row.id, error: markError.message });
    }
    return 'failed';
  }
}

/**
 * One tick.
 *
 * @returns {Promise<{claimed:number, sent:number, skipped:number, failed:number, expired:number, deferred:number, off?:true}>}
 */
async function runSweep({ now = new Date(), limit = store.DEFAULT_CLAIM_LIMIT } = {}) {
  const counts = { claimed: 0, sent: 0, skipped: 0, failed: 0, expired: 0, deferred: 0 };

  if (!isEnabled()) return { off: true, ...counts };

  try {
    counts.expired = await store.expireStuck({ now });
  } catch (error) {
    logError('expireStuck failed', { error: error.message });
  }

  for (const [kind, { handler, prepare }] of registry) {
    if (prepare) {
      try {
        await prepare({ now });
      } catch (error) {
        // The cohort may be short, but rows scheduled on an earlier tick are
        // still due — skipping the claim as well would strand them.
        logError('prepare failed; claiming anyway', { kind, error: error.message });
      }
    }

    let rows = [];
    try {
      rows = await store.claimDue({ kind, limit, now });
    } catch (error) {
      logError('claim failed', { kind, error: error.message });
      continue;
    }

    counts.claimed += rows.length;
    for (const row of rows) {
      counts[await handleRow(kind, row, handler, now)] += 1;
    }
  }

  logEvent('teacher_nudges.sweep', counts);
  return counts;
}

module.exports = { register, runSweep, isEnabled };
