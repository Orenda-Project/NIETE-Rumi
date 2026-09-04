'use strict';
/**
 * The READ-ONLY replica client (bd-vrbk4.2) — used by the live-calls stack only.
 *
 * NIETE production has a read replica alongside the primary:
 *   primary  https://ihzciabopbttygxxgrkm.supabase.co
 *   replica  https://ihzciabopbttygxxgrkm-rr-ap-south-1-tlrbo.supabase.co
 * Same service-role key, read-only. A live call fans out ~8 lookups while a
 * teacher waits, and the operator asked that this traffic not land on the
 * database every other feature shares.
 *
 * ── The one rule ─────────────────────────────────────────────────────────────
 * The replica serves reads of tables THIS STACK DOES NOT WRITE. Everything the
 * calls stack writes — `calls`, `call_trace`, `call_memory` — is read back from
 * the primary, because each of those reads is a read-after-write and each one's
 * failure mode is silent:
 *
 *   call_memory  written at call end, read at the next call's start → on the
 *                replica, a caller who rings back inside the lag window meets an
 *                assistant that has forgotten her, and we go hunting a
 *                summariser bug that does not exist.
 *   calls        the budget governor's inputs (callsToday, weeklySpendUsd) count
 *                rows this stack just inserted → on the replica, a redial inside
 *                the lag window walks through the per-caller daily limit, and
 *                the weekly cap has the same hole in dollars.
 *
 * If someone later "tidies" those onto the replica for consistency, they will
 * reintroduce two bugs that both present as something other than what they are.
 * `bot/tests/calls/call-context-replica.test.js` asserts the pinning.
 *
 * ── Degradation ──────────────────────────────────────────────────────────────
 * With no NIETE_SUPABASE_REPLICA_URL set this module IS the primary client, so
 * staging and any fresh clone behave exactly as before. And a replica read that
 * throws is retried once on the primary: a replica outage must cost us latency,
 * never a call.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const primary = require('./supabase');
const { logToFile } = require('../utils/logger');

const replicaUrl = (process.env.NIETE_SUPABASE_REPLICA_URL || '').trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const replica = (replicaUrl && serviceRoleKey)
  ? createClient(replicaUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  : null;

/** True when a distinct replica is configured; false means reads use the primary. */
function isReplicaEnabled() {
  return replica !== null;
}

/**
 * Run a read against the replica, falling back to the primary if it fails.
 *
 * `run` receives the client and MUST throw on a Supabase `error` — the callers
 * here already do (`if (error) throw …`), which is what makes one retry cover
 * both a transport failure and a query error. The primary attempt is not
 * wrapped: if it fails, that is a real failure and belongs to the caller.
 *
 * @param {(db: object) => Promise<any>} run
 */
async function readWithFallback(run) {
  if (!replica) return run(primary);
  try {
    return await run(replica);
  } catch (err) {
    logToFile('[calls] replica read failed — retrying on primary', { error: err.message });
    return run(primary);
  }
}

module.exports = { readWithFallback, isReplicaEnabled };
