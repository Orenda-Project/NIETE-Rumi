'use strict';
/**
 * bd-t8zeu9 — V1.8.9 turns row level security on for niete_lp_downloads (it holds teacher phone numbers) and
 * niete_lp612_deliveries, and takes away every privilege anon and authenticated hold on them.
 *
 * Two layers.
 *  1. Static checks on the SQL. Always run, CI included.
 *  2. Behaviour on a real Postgres. Runs when one is reachable, and is skipped (with a note) when not:
 *       PG_TEST_URL   a superuser URL to a THROWAWAY server (the test creates roles there), or
 *       a local initdb (PG_BIN, Homebrew postgresql@17, apt postgresql/17, or initdb on PATH).
 *     The fixture is built the way the live projects are (catalog read 2026-11-04):
 *       - exec_sql is SECURITY DEFINER and owned by a non-superuser BYPASSRLS role, standing in for Supabase's
 *         `postgres`, and the migration is sent through it as service_role, one call per file, as migrate.js does;
 *       - the tables are owned by app_owner (BYPASSRLS), which that role is a member of, as on sandbox;
 *       - anon and authenticated hold ALL on both tables, as on staging (sandbox holds a subset of this);
 *       - app_rw holds read/write without BYPASSRLS and has no login member, as on sandbox.
 *     The same `postgres` stand-in is also the role the portal's pool logs in as on sandbox and staging
 *     (pg_stat_activity: every pooled client is `postgres`), so it is the portal reader here.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MIG = path.join(ROOT, 'infrastructure', 'supabase', 'migrations');
const UP = 'V1.8.9__lp_downloads_rls.sql';
const DOWN = 'ROLLBACK_V1.8.9__lp_downloads_rls.sql';
const TABLES = ['niete_lp_downloads', 'niete_lp612_deliveries'];

const read = (f) => fs.readFileSync(path.join(MIG, f), 'utf8');
const code = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('V1.8.9 SQL (static)', () => {
  test.each(TABLES)('turns row level security on for %s', (t) => {
    expect(code(read(UP))).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY;`));
  });

  test.each(TABLES)('revokes everything anon and authenticated hold on %s', (t) => {
    expect(code(read(UP))).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${t} FROM anon, authenticated;`));
  });

  test('adds no policy: every reader of these tables bypasses RLS (service role, the portal login, the table owner)', () => {
    expect(code(read(UP))).not.toMatch(/CREATE POLICY/i);
  });

  test('fails fast behind a long transaction instead of queueing readers, and carries no transaction control', () => {
    const up = code(read(UP));
    expect(up).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(up).not.toMatch(/\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/);
  });

  test.each(TABLES)('the rollback turns row level security back off on %s', (t) => {
    expect(code(read(DOWN))).toMatch(new RegExp(`ALTER TABLE public\\.${t} DISABLE ROW LEVEL SECURITY;`));
  });

  test('the rollback does not hand anon or authenticated their grants back', () => {
    expect(code(read(DOWN))).not.toMatch(/GRANT[^;]*\b(anon|authenticated)\b/i);
  });

  test.each(TABLES)('the e2e baseline and the fresh-install RLS file agree for %s', (t) => {
    const baseline = fs.readFileSync(path.join(ROOT, 'supabase', 'baseline', 'schema.sql'), 'utf8');
    expect(baseline).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY;`));
    expect(baseline).not.toMatch(new RegExp(`GRANT [^;]* ON TABLE public\\.${t} TO (anon|authenticated);`));
    const fresh = fs.readFileSync(path.join(ROOT, 'infrastructure', 'supabase', '01_rls-policies.sql'), 'utf8');
    expect(code(fresh)).toMatch(new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`));
  });
});

// ── real Postgres ────────────────────────────────────────────────────────────────────────────────────────
function pgBin() {
  const cands = [process.env.PG_BIN, '/opt/homebrew/opt/postgresql@17/bin', '/usr/local/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'];
  for (const c of cands) if (c && fs.existsSync(path.join(c, 'initdb')) && fs.existsSync(path.join(c, 'postgres'))) return c;
  const w = spawnSync('which', ['initdb'], { encoding: 'utf8' });
  const d = w.status === 0 && w.stdout.trim() ? path.dirname(w.stdout.trim()) : null;
  return d && fs.existsSync(path.join(d, 'postgres')) ? d : null;
}
const PG_URL = process.env.PG_TEST_URL || '';
const BIN = PG_URL ? null : pgBin();
const realPg = Boolean(PG_URL || BIN);
if (!realPg) {
  // eslint-disable-next-line no-console
  console.log('lp-downloads-rls-migration: no Postgres (set PG_TEST_URL or PG_BIN); the behaviour checks are skipped');
}

function baselineTable(sql, t) {
  const s = sql.indexOf(`CREATE TABLE public.${t} (`);
  if (s < 0) throw new Error(`baseline has no table ${t}`);
  return `${sql.slice(s, sql.indexOf('\n);', s) + 3)}\nALTER TABLE public.${t} ADD PRIMARY KEY (id);\n`;
}

const FIXTURE = () => {
  const baseline = fs.readFileSync(path.join(ROOT, 'supabase', 'baseline', 'schema.sql'), 'utf8');
  const role = (r, attrs) => `DO $$ BEGIN CREATE ROLE ${r} ${attrs}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
  return [
    role('anon', 'NOLOGIN'), role('authenticated', 'NOLOGIN'), role('service_role', 'NOLOGIN BYPASSRLS'),
    role('supa_postgres', 'NOLOGIN BYPASSRLS'), role('app_owner', 'NOLOGIN BYPASSRLS'), role('app_rw', 'NOLOGIN'),
    'GRANT app_owner TO supa_postgres;',
    'GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, supa_postgres, app_owner, app_rw;',
    ...TABLES.map((t) => baselineTable(baseline, t)),
    ...TABLES.map((t) => `ALTER TABLE public.${t} OWNER TO app_owner;
      GRANT ALL ON TABLE public.${t} TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${t} TO app_rw;`),
    `CREATE FUNCTION public.exec_sql(query text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
       AS $f$ BEGIN EXECUTE query; END; $f$;
     ALTER FUNCTION public.exec_sql(text) OWNER TO supa_postgres;
     GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role;`,
    `INSERT INTO public.niete_lp_downloads (user_id, lesson_id, phone, status) VALUES (gen_random_uuid(), 'grade_1_maths_ch1_seg1', '15550000001', 'sent');
     INSERT INTO public.niete_lp612_deliveries (user_id, segment_id, lang, template_version) VALUES (gen_random_uuid(), 'seg', 'en', 'v1');`,
  ].join('\n');
};

(realPg ? describe : describe.skip)('V1.8.9 on a real Postgres (behaviour)', () => {
  jest.setTimeout(90000);
  // The root jest config maps `pg` to a stub; the real driver lives in dashboard/node_modules.
  let Pool;
  let pool;
  let admin;
  let cleanup = async () => {};

  beforeAll(async () => {
    ({ Pool } = require(path.join(ROOT, 'dashboard', 'node_modules', 'pg')));
    let conn;
    if (PG_URL) {
      const db = `t8zeu9_${process.pid}_${Date.now()}`;
      admin = new Pool({ connectionString: PG_URL, max: 1 });
      await admin.query(`CREATE DATABASE ${db}`);
      const u = new URL(PG_URL); u.pathname = `/${db}`;
      conn = { connectionString: u.toString() };
      cleanup = async () => { await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`); await admin.end(); };
    } else {
      const dir = fs.mkdtempSync(path.join(fs.existsSync('/tmp') ? '/tmp' : os.tmpdir(), 'rls-'));
      const sock = path.join(dir, 's'); fs.mkdirSync(sock);
      const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
      execFileSync(path.join(BIN, 'initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore', env });
      execFileSync(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-o', `-k ${sock} -c listen_addresses='' -c fsync=off`, '-l', path.join(dir, 'log'), '-w', 'start'], { stdio: 'ignore', env });
      conn = { host: sock, user: 'postgres', database: 'postgres' };
      cleanup = async () => {
        try { execFileSync(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore', env }); } catch (_) { /* gone */ }
        fs.rmSync(dir, { recursive: true, force: true });
      };
    }
    pool = new Pool({ ...conn, max: 2 });
    await pool.query('SET client_min_messages = warning');
    await pool.query(FIXTURE());
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await cleanup();
  });

  /** One transaction as `role`, rolled back: what that role can do, never leaving a trace. */
  async function as(role, sql) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${role}`);
      return await c.query(sql);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  }
  const denied = (role, sql) => as(role, sql).then(() => 'allowed', (e) => e.code);
  const count = async (role, t) => Number((await as(role, `SELECT count(*)::int AS n FROM public.${t}`)).rows[0].n);

  /** Apply one migration file the way migrate.js does: the whole file as ONE exec_sql call, as service_role. */
  async function applyFile(file) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE service_role');
      await c.query('SELECT public.exec_sql($1)', [read(file)]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  const rls = async () => (await pool.query(
    `SELECT relname, relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1) ORDER BY 1`, [TABLES])).rows;
  const anyPriv = async (role) => (await pool.query(
    `SELECT bool_or(has_table_privilege($1, ('public.' || t)::regclass, p)) AS any
       FROM unnest($2::text[]) t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p`,
    [role, TABLES])).rows[0].any;

  test('the fixture reproduces the hole: before V1.8.9 anon reads the phone table', async () => {
    expect(await count('anon', 'niete_lp_downloads')).toBe(1);
  });

  test('V1.8.9 applies through exec_sql as service_role, and RLS is on (not forced) for both tables', async () => {
    await applyFile(UP);
    expect(await rls()).toEqual([
      { relname: 'niete_lp612_deliveries', on: true, forced: false },
      { relname: 'niete_lp_downloads', on: true, forced: false },
    ]);
  });

  test.each([['anon'], ['authenticated']])('%s holds no privilege on either table and is refused', async (role) => {
    expect(await anyPriv(role)).toBe(false);
    for (const t of TABLES) {
      expect(await denied(role, `SELECT 1 FROM public.${t} LIMIT 1`)).toBe('42501');
      expect(await denied(role, `DELETE FROM public.${t}`)).toBe('42501');
    }
    expect(await denied(role, `INSERT INTO public.niete_lp_downloads (lesson_id, status) VALUES ('x', 'sent')`)).toBe('42501');
  });

  test.each([['service_role'], ['supa_postgres'], ['app_owner']])('%s still reads every row of both tables', async (role) => {
    for (const t of TABLES) expect(await count(role, t)).toBe(1);
  });

  test('the bot (service role) still records a send', async () => {
    const r = await as('service_role', `INSERT INTO public.niete_lp_downloads (user_id, lesson_id, phone, status)
      VALUES (gen_random_uuid(), 'grade_1_maths_ch1_seg2', '15550000002', 'sent') RETURNING id`);
    expect(r.rows).toHaveLength(1);
  });

  test('a second run changes nothing', async () => {
    const before = await rls();
    await applyFile(UP);
    expect(await rls()).toEqual(before);
    expect(await anyPriv('anon')).toBe(false);
  });

  test('the rollback turns RLS off and does not give anon its grants back; re-applying works', async () => {
    await applyFile(DOWN);
    expect((await rls()).map((r) => r.on)).toEqual([false, false]);
    expect(await anyPriv('anon')).toBe(false);
    expect(await count('service_role', 'niete_lp_downloads')).toBe(1);
    await applyFile(UP);
    expect((await rls()).map((r) => r.on)).toEqual([true, true]);
  });
});
