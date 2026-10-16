'use strict';
/**
 * "Prepared, not yet sent": a library share code the home (or the maker) minted so its class message could be shown
 * BEFORE the send tap (the send is a plain wa.me link, so the code must exist first). Until the teacher taps send,
 * that code is not a send: the home's class line ("No one in your class has played yet — Send again") must not
 * appear for it. Kept in Redis only, for 4 days: longer than the class line's 72 h window, and short enough that a
 * clear that never landed hides a real send for days, not a month. A Redis that is down → nothing is marked and every
 * code counts as sent (today's reading).
 */
const PREFIX = 'th:prep:';
const TTL_S = 4 * 86400;
const redis = () => require('../cache/railway-redis.service');

async function markPrepared(shareCodeId) {
  if (!shareCodeId) return;
  try { await redis().set(`${PREFIX}${shareCodeId}`, '1', TTL_S); } catch (_) { /* counted as sent */ }
}

/** Clears "prepared" (one retry) → true when cleared or nothing to clear; false when the clear failed twice. */
async function markSent(shareCodeId) {
  if (!shareCodeId) return true;
  for (let i = 0; i < 2; i += 1) {
    try { await redis().delete(`${PREFIX}${shareCodeId}`); return true; } catch (_) { /* once more */ }
  }
  return false;
}

/** → the subset of ids still only prepared. */
async function prepared(ids) {
  const out = new Set();
  await Promise.all((ids || []).map(async (id) => {
    try { if (await redis().get(`${PREFIX}${id}`)) out.add(id); } catch (_) { /* counted as sent */ }
  }));
  return out;
}

module.exports = { markPrepared, markSent, prepared, PREFIX };
