'use strict';
/**
 * bd-s8mi25 — who a ready render still OWES its PDF to, kept for a few hours in Redis.
 *
 * The worker claims the waiter list (one statement that reads it AND empties it — see claimWaiters
 * in lp612-author.worker.js) and then sends to each teacher. If the container dies between the
 * claim and the last send (a deploy's SIGTERM, an OOM), the list is gone from the row and SQS's
 * redelivery sees `status: 'ready'` and skips: the teacher has the summary text and no PDF.
 *
 * So the claimed audience is remembered here before the first send and forgotten after the loop;
 * a redelivered job reads it back (lp612-redeliver.js). Redis, not a column: no migration, and a
 * Redis that is down simply means the old behaviour — never a failed lesson. Never throws.
 */

const redis = require('./cache/railway-redis.service');
const { logToFile } = require('../utils/logger');

// Longer than SQS's redelivery gap (15 min on 11 Nov) with room for a slow queue; short enough
// that a forgotten key cannot resend a lesson the next day.
const TTL_SECS = 6 * 60 * 60;
const key = (renderId) => `lp612:owed:${renderId}`;

async function remember(renderId, waiters) {
  if (!renderId || !Array.isArray(waiters) || waiters.length === 0) return;
  try {
    await redis.set(key(renderId), waiters, TTL_SECS);
  } catch (err) {
    logToFile('LP 6-12: could not remember who is owed this render', { renderId, error: err.message });
  }
}

async function recall(renderId) {
  if (!renderId) return [];
  try {
    const data = await redis.get(key(renderId));
    return Array.isArray(data) ? data.filter((w) => w && (w.phone || w.user_id)) : [];
  } catch (err) {
    logToFile('LP 6-12: could not recall who is owed this render', { renderId, error: err.message });
    return [];
  }
}

async function forget(renderId) {
  if (!renderId) return;
  try {
    await redis.delete(key(renderId));
  } catch (err) {
    logToFile('LP 6-12: could not forget who was owed this render', { renderId, error: err.message });
  }
}

module.exports = { remember, recall, forget, TTL_SECS };
