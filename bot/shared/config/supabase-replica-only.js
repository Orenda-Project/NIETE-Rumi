'use strict';
/**
 * The READ REPLICA, and nothing else — for scheduled jobs that must never put their reads on the primary (the
 * twice-a-day teacher activity count, docs/teacher-activity-store.md).
 *
 * Not ./supabase-replica.js: that one serves live calls, so a replica failure retries on the PRIMARY and an unset URL
 * IS the primary. Here both are refusals:
 *   replicaClient()      the replica client (NIETE_SUPABASE_REPLICA_URL + SUPABASE_SERVICE_ROLE_KEY), or null when
 *                        either is unset — the job is off on that tier. The primary client module is never loaded.
 *   checkReplica(client) asks the server itself (rpc db_is_replica, migration V1.10.4 = pg_is_in_recovery()), so a URL
 *                        that points at the primary by mistake is caught too. { ok: true } only on an exact true;
 *                        anything else is { ok: false, reason: 'no_replica' | 'not_replica' | 'check_failed' }.
 * Call checkReplica at the start of every run, and refuse the run unless ok.
 *
 * Test sites (staging, sandbox) have no paid read copy (decided 20 Nov 2026), so there, and only there, an unset
 * replica URL means the tier's own database (SUPABASE_URL). The tier is Railway's own RAILWAY_ENVIRONMENT_NAME, and it
 * must be exactly 'staging' or 'sandbox': production, an unset name or any other name keeps the replica-only rule.
 * checkReplica passes that one client without asking ({ ok: true, tier: 'test_site' }); any other client still asks.
 */
const url = (process.env.NIETE_SUPABASE_REPLICA_URL || '').trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_SITES = ['staging', 'sandbox'];
const testSite = TEST_SITES.includes(process.env.RAILWAY_ENVIRONMENT_NAME);
const ownUrl = (process.env.SUPABASE_URL || '').trim();
let client;
let testSiteClient = null;

function replicaClient() {
  if (client !== undefined) return client;
  const target = url || (testSite ? ownUrl : '');
  if (!target || !key) {
    client = null;
    return client;
  }
  const { createClient } = require('@supabase/supabase-js');
  client = createClient(target, key, { auth: { autoRefreshToken: false, persistSession: false } });
  if (!url) testSiteClient = client;
  return client;
}

async function checkReplica(db) {
  if (!db) return { ok: false, reason: 'no_replica' };
  if (testSiteClient && db === testSiteClient) return { ok: true, tier: 'test_site' };
  try {
    const { data, error } = await db.rpc('db_is_replica');
    if (error) return { ok: false, reason: 'check_failed' };
    return data === true ? { ok: true } : { ok: false, reason: 'not_replica' };
  } catch (_) {
    return { ok: false, reason: 'check_failed' };
  }
}

module.exports = { replicaClient, checkReplica };
