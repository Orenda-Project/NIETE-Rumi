// Apply migration 017 (lp_feedback table) to NIETE Supabase.
//
// Tries common Supabase pooler regions in order. Falls back to printing the
// SQL for the operator to paste into the Supabase SQL editor if all pooler
// attempts fail.
//
// Verifies success by round-tripping a select against the new table.

const fs = require('fs');
const path = require('path');
function loadEnv(p) {
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv(process.env.NIETE_ENV_PATH || path.resolve(__dirname, '..', '..', '..', '.env'));

const supabase = require('../../shared/config/supabase');
const MIGRATION_PATH = path.resolve(__dirname, '..', '..', 'database', 'migrations', '017_lp_feedback.sql');
const SQL = fs.readFileSync(MIGRATION_PATH, 'utf8');

function projectRef() {
  const url = new URL(process.env.SUPABASE_URL);
  return url.hostname.split('.')[0];
}

async function tryPoolerApply() {
  let Client;
  try { Client = require('pg').Client; } catch (_) {
    console.log('  [pg not installed here — skipping direct pooler attempt]');
    return { ok: false, reason: 'no-pg' };
  }
  const ref = projectRef();
  const pwd = process.env.SUPABASE_DB_PASSWORD;
  if (!pwd) return { ok: false, reason: 'no-password' };

  // Try the two most common regions used by Pakistan/SEA Supabase projects
  const REGIONS = ['ap-south-1', 'ap-southeast-1', 'us-east-1', 'us-west-1', 'eu-west-1'];
  for (const region of REGIONS) {
    for (const poolerIdx of [0, 1]) {
      const host = `aws-${poolerIdx}-${region}.pooler.supabase.com`;
      const port = 6543;
      const user = `postgres.${ref}`;
      console.log(`  Trying pooler ${host}:${port} as ${user}...`);
      const client = new Client({
        host, port, database: 'postgres', user, password: pwd,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });
      try {
        await client.connect();
        console.log(`  ✓ Connected via ${host}. Applying migration...`);
        await client.query(SQL);
        console.log('  ✓ Migration executed.');
        await client.end();
        return { ok: true, host };
      } catch (e) {
        try { await client.end(); } catch (_) {}
        if (/timeout|ENOTFOUND|EAI_AGAIN/i.test(e.message)) continue;
        console.log(`  ✗ ${host} → ${e.message.split('\n')[0].slice(0, 100)}`);
      }
    }
  }
  return { ok: false, reason: 'all-regions-failed' };
}

async function verifyTableExists() {
  // A select on an empty table with limit 0 succeeds if the table exists.
  const { error } = await supabase.from('lp_feedback').select('id').limit(1);
  if (!error) return true;
  if (/relation.*does not exist|Could not find the table/i.test(error.message || '')) return false;
  console.log(`  verify: unexpected error: ${error.message}`);
  return false;
}

(async () => {
  console.log('=== Migration 017: lp_feedback ===\n');

  // 1. Is it already applied?
  console.log('1. Checking whether lp_feedback already exists...');
  if (await verifyTableExists()) {
    console.log('   ✓ Table already exists. Nothing to do. Idempotent success.');
    return;
  }
  console.log('   ✗ Not present. Applying migration.\n');

  // 2. Try direct pooler application
  console.log('2. Attempting direct Postgres pooler application...');
  const attempt = await tryPoolerApply();
  if (attempt.ok) {
    console.log(`\n3. Verifying...`);
    if (await verifyTableExists()) {
      console.log('   ✓ lp_feedback verified via Supabase JS client. Migration complete.');
      return;
    } else {
      console.log('   ⚠ DDL ran but verification failed — Supabase JS view may need a refresh.');
      return;
    }
  }
  console.log(`\n   Direct pooler apply failed (${attempt.reason}).`);

  // 3. Fallback — print instructions
  console.log('\n─── MANUAL APPLICATION REQUIRED ───');
  console.log('Open: https://supabase.com/dashboard/project/' + projectRef() + '/sql/new');
  console.log('Paste the contents of:');
  console.log('  ' + MIGRATION_PATH);
  console.log('and click RUN.');
  console.log('\nThen re-run this script to verify.');
})().catch(e => { console.error('FATAL:', e.message); process.exit(2); });
