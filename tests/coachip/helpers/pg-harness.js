'use strict';
/**
 * bd-sex15q.13 — a throwaway Postgres for the COACHIP route tests, so the SQL the routes run is the SQL the tests run.
 *
 * The routes read the c-insights tables and five live tables (users, schools, leader_schools, observation_schedules,
 * coaching_sessions) plus app_settings. Each test file gets its own cluster in a temp dir on a unix socket (no TCP
 * port), built from:
 *   1. the repo's own CREATE TABLE statements for those six tables, cut from supabase/baseline/schema.sql (so a
 *      column the routes name that the real table does not have fails here, not on sandbox);
 *   2. the COACHIP migration: infrastructure/supabase/migrations/V1.8.*__coachip*.sql once m-insights lands it,
 *      until then tests/coachip/fixtures/insights_schema.sql (the c-insights contract file, verbatim).
 *
 * Needs a Postgres 15+ server binary: PG_BIN, else Homebrew's postgresql@17, else initdb on PATH. Without one the
 * suites that need it are skipped and say so (hasPostgres()). Nothing here can reach a real database: the only
 * connection is the socket in the temp dir.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
// The root jest config maps `pg` to a stub; the real driver lives in dashboard/node_modules.
const { Pool } = require(path.join(ROOT, 'dashboard', 'node_modules', 'pg'));

const BASE_TABLES = ['users', 'schools', 'leader_schools', 'coaching_sessions', 'observation_schedules', 'app_settings'];

function pgBin() {
  const cands = [process.env.PG_BIN, '/opt/homebrew/opt/postgresql@17/bin', '/usr/local/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'];
  for (const c of cands) if (c && fs.existsSync(path.join(c, 'initdb'))) return c;
  const w = spawnSync('which', ['initdb'], { encoding: 'utf8' });
  return w.status === 0 && w.stdout.trim() ? path.dirname(w.stdout.trim()) : null;
}

function hasPostgres() { return !!pgBin(); }

/** The CREATE TABLE block for one table, cut from the baseline dump (FKs live in later ALTERs, so none come along). */
function baselineTable(sql, table) {
  const start = sql.indexOf(`CREATE TABLE public.${table} (`);
  if (start < 0) throw new Error(`baseline has no table ${table}`);
  const end = sql.indexOf('\n);', start);
  return `${sql.slice(start, end + 3)}\nALTER TABLE public.${table} ADD PRIMARY KEY (${table === 'app_settings' ? 'key' : 'id'});\n`;
}

function insightsMigration() {
  const dir = path.join(ROOT, 'infrastructure', 'supabase', 'migrations');
  const real = fs.readdirSync(dir).filter((f) => /^V1\.8\.\d+__coachip.*\.sql$/.test(f)).sort();
  if (real.length) return real.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'insights_schema.sql'), 'utf8');
}

function schemaSql() {
  const baseline = fs.readFileSync(path.join(ROOT, 'supabase', 'baseline', 'schema.sql'), 'utf8');
  const prelude = `
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE FUNCTION extensions.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
    DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;
    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
  `;
  return [prelude, ...BASE_TABLES.map((t) => baselineTable(baseline, t)), insightsMigration()].join('\n');
}

/**
 * Start a cluster, apply the schema, return { query, pool, withTx, truncate, close }.
 * `query(sql, params)` has the pg Pool's shape (what dashboard/config/database exports).
 */
async function startPg() {
  const bin = pgBin();
  if (!bin) throw new Error('no Postgres server binary (set PG_BIN)');
  // /tmp, not os.tmpdir(): a unix socket path must stay under ~100 bytes and macOS's per-user tmpdir is long.
  const dir = fs.mkdtempSync(path.join(fs.existsSync('/tmp') ? '/tmp' : os.tmpdir(), 'cpg-'));
  const sock = path.join(dir, 's');
  fs.mkdirSync(sock);
  // LC_ALL=C: without a valid locale the macOS postmaster refuses to start ("became multithreaded during startup").
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
  execFileSync(path.join(bin, 'initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore', env });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-o', `-k ${sock} -c listen_addresses='' -c fsync=off -c timezone=UTC`, '-l', path.join(dir, 'log'), '-w', 'start'], { stdio: 'ignore', env });
  const pool = new Pool({ host: sock, user: 'postgres', database: 'postgres', max: 4 });
  const client = await pool.connect();
  try {
    await client.query('SET client_min_messages = warning');
    await client.query(schemaSql());
  } finally {
    client.release();
  }
  const stop = () => {
    try { execFileSync(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore', env }); } catch (_) { /* gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return {
    pool,
    query: (sql, params) => pool.query(sql, params),
    async truncate() {
      const { rows } = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        AND tablename NOT IN ('coachip_weaknesses', 'coachip_interventions', 'coachip_weakness_signals', 'coachip_audit_log', 'coachip_teacher_codes')`);
      // The audit log and the code space refuse DELETE/TRUNCATE by trigger (append-only, never reassigned): disable it for the reset only.
      await pool.query('SET session_replication_role = replica');
      await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')}, coachip_audit_log, coachip_teacher_codes CASCADE`);
      await pool.query('SET session_replication_role = origin');
    },
    async close() { await pool.end(); stop(); },
  };
}

module.exports = { startPg, hasPostgres, schemaSql, ROOT };
