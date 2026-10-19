'use strict';
/**
 * Live moves (bd-v0toag.31): at most `limit` live streams at once. Each live id holds one slot until it is released
 * or goes `idleMs` without a touch. Pure and in process memory: the bot web service runs one replica (checked on
 * staging and prod 19 Oct), so one process sees every stream. Never use it from the SQS workers (10 replicas).
 */
function createStreamCap({ limit = 5, idleMs = 180_000 } = {}) {
  const seen = new Map(); // liveId → last touch

  const sweep = (now) => {
    for (const [id, at] of seen) if (now - at >= idleMs) seen.delete(id);
  };

  return {
    acquire(liveId, now) {
      sweep(now);
      if (!seen.has(liveId) && seen.size >= limit) return false;
      seen.set(liveId, now);
      return true;
    },
    touch(liveId, now) {
      if (seen.has(liveId)) seen.set(liveId, now);
    },
    release(liveId) {
      seen.delete(liveId);
    },
    size(now) {
      sweep(now);
      return seen.size;
    },
  };
}

module.exports = { createStreamCap };
