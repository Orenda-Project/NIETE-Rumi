// Apply migration 018 (niete_lp_assets + niete_lp_downloads + lp_feedback.useful_component)
// to NIETE Supabase.
//
// Mirrors apply-017-lp-feedback.js: try the Supabase pooler directly, verify by
// round-tripping a select, and fall back to printing paste-into-the-SQL-editor
// instructions. The migration itself is fully idempotent, so re-running this
// script at any point is safe.
//
// Requires SUPABASE_URL + SUPABASE_DB_PASSWORD in the env file. If the pooler
// route is unavailable, the manual path is the supported one — do NOT hand-edit
// the SQL to "make it work".

const fs = require('fs');
const path = require('path');

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv(process.env.NIETE_ENV_PATH || path.resolve(__dirname, '..', '..', '..', '.env'));

const supabase = require('../../shared/config/supabase');

const MIGRATION_PATH = path.resolve(
  __dirname, '..', '..', 'database', 'migrations', '018_niete_lp_assets_and_downloads.sql',
);
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

  const REGIONS = ['ap-south-1', 'ap-southeast-1', 'us-east-1', 'us-west-1', 'eu-west-1'];
  for (const region of REGIONS) {
    for (const poolerIdx of [0, 1]) {
      const host = `aws-${poolerIdx}-${region}.pooler.supabase.com`;
      const client = new Client({
        host, port: 6543, database: 'postgres', user: `postgres.${ref}`, password: pwd,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });
      console.log(`  Trying pooler ${host}:6543 as postgres.${ref}...`);
      try {
        await client.connect();
        console.log(`  ✓ Connected via ${host}. Applying migration...`);
        await client.query(SQL);
        console.log('  ✓ Migration executed.');
        await client.end();
        return { ok: true, host };
      } catch (e) {
        try { await client.end(); } catch (_) { /* ignore */ }
        if (/timeout|ENOTFOUND|EAI_AGAIN/i.test(e.message)) continue;
        console.log(`  ✗ ${host} → ${e.message.split('\n')[0].slice(0, 120)}`);
      }
    }
  }
  return { ok: false, reason: 'all-regions-failed' };
}

async function tableExists(table) {
  const { error } = await supabase.from(table).select('id').limit(1);
  if (!error) return true;
  if (/relation.*does not exist|Could not find the table/i.test(error.message || '')) return false;
  console.log(`  verify(${table}): unexpected error: ${error.message}`);
  return false;
}

async function columnExists(table, column) {
  const { error } = await supabase.from(table).select(column).limit(1);
  if (!error) return true;
  if (/column .* does not exist|Could not find the '.*' column/i.test(error.message || '')) return false;
  console.log(`  verify(${table}.${column}): unexpected error: ${error.message}`);
  return false;
}

async function fullyApplied() {
  return (await tableExists('niete_lp_assets'))
    && (await tableExists('niete_lp_downloads'))
    && (await columnExists('lp_feedback', 'useful_component'));
}

(async () => {
  console.log('=== Migration 018: niete_lp_assets + niete_lp_downloads ===\n');

  console.log('1. Checking current state...');
  console.log(`   niete_lp_assets            : ${(await tableExists('niete_lp_assets')) ? 'present' : 'MISSING'}`);
  console.log(`   niete_lp_downloads         : ${(await tableExists('niete_lp_downloads')) ? 'present' : 'MISSING'}`);
  console.log(`   lp_feedback.useful_component: ${(await columnExists('lp_feedback', 'useful_component')) ? 'present' : 'MISSING'}`);

  if (await fullyApplied()) {
    console.log('\n   ✓ Already fully applied. Nothing to do (idempotent success).');
    return;
  }

  console.log('\n2. Attempting direct Postgres pooler application...');
  const attempt = await tryPoolerApply();

  if (attempt.ok) {
    console.log('\n3. Verifying...');
    if (await fullyApplied()) {
      console.log('   ✓ All three objects verified via the Supabase JS client. Migration complete.');
    } else {
      console.log('   ⚠ DDL ran but verification is incomplete — the PostgREST schema cache may');
      console.log('     need a moment. Re-run this script to confirm before using the uploader.');
    }
    return;
  }

  console.log(`\n   Direct pooler apply failed (${attempt.reason}).`);
  console.log('\n─── MANUAL APPLICATION REQUIRED ───');
  console.log(`Open: https://supabase.com/dashboard/project/${projectRef()}/sql/new`);
  console.log('Paste the contents of:');
  console.log(`  ${MIGRATION_PATH}`);
  console.log('and click RUN. The migration is idempotent — a partial earlier run is fine.');
  console.log('\nThen re-run this script to verify.');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
