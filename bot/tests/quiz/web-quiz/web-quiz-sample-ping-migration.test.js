'use strict';
/**
 * web_quiz_sample_ping.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no TCP).
 * The two tables of the direct ping: sample_ping_consents (one row per live binding that consented, keyed by the
 * binding) and sample_pings (one row per phone tombstone per term). One ping per (term_code, phone_tomb); the state
 * CHECK; RLS on with no policy; no phone, name or child column; applies twice; the rollback drops these two tables and
 * nothing else; the block in infrastructure/supabase/00_complete-schema.sql builds the same tables.
 *
 * Needs the Postgres server binaries (postgres, initdb, pg_ctl, psql: PG_BIN or pg_config --bindir); without them the
 * suite is skipped and says so.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MIG = path.join(__dirname, '..', '..', '..', 'database', 'migrations');
const SCHEMA = path.join(__dirname, '..', '..', '..', '..', 'infrastructure', 'supabase', '00_complete-schema.sql');
const MIRROR_HEAD = '-- Web quiz direct ping (mirror of bot/database/migrations/web_quiz_sample_ping.sql)';
const binDir = (() => {
  const cands = [process.env.PG_BIN];
  try { cands.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* none */ }
  cands.push('/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/local/bin');
  return cands.find((c) => c && ['postgres', 'initdb', 'pg_ctl', 'psql'].every((b) => fs.existsSync(path.join(c, b)))) || null;
})();
const bin = (b) => path.join(binDir, b);
const PG = !!binDir;
const d = PG ? describe : describe.skip;
if (!PG) console.warn('web-quiz-sample-ping-migration: no Postgres server binaries found (set PG_BIN) — skipped');

let dir;
let sock;
const PORT = String(56000 + (process.pid % 900));
const psql = (sql, { file = null, user = 'postgres', db = 'postgres' } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', user, '-d', db, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql, opts) => { try { psql(sql, opts); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f, db = 'postgres') => psql(null, { file: path.join(MIG, f), db });
const TABLES = ['sample_ping_consents', 'sample_pings'];

/** The mirror block: from its header to the next section rule after the block's own SQL (or the file's NOTIFY). */
function mirrorBlock() {
  const text = fs.readFileSync(SCHEMA, 'utf8');
  const at = text.indexOf(MIRROR_HEAD);
  if (at < 0) return null;
  const rest = text.slice(at);
  const body = rest.split('\n').slice(2).join('\n');          // past the header line and its closing rule
  const next = body.search(/\n-- ─{20,}\n|\nNOTIFY pgrst/);
  return next < 0 ? body : body.slice(0, next);
}

/** What the tables ARE (columns, types, nullability, defaults, constraints, indexes, RLS) — comments aside. */
const FINGERPRINT = `
  select string_agg(x, E'\\n' order by x) from (
    select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-') as x
      from information_schema.columns where table_schema = 'public' and table_name in ('sample_ping_consents', 'sample_pings')
    union all
    select 'con ' || conrelid::regclass::text || ' ' || pg_get_constraintdef(oid)
      from pg_constraint where conrelid in ('public.sample_ping_consents'::regclass, 'public.sample_pings'::regclass)
    union all
    select 'idx ' || tablename || ' ' || regexp_replace(indexdef, 'INDEX \\S+ ON', 'INDEX ON')
      from pg_indexes where schemaname = 'public' and tablename in ('sample_ping_consents', 'sample_pings')
    union all
    select 'rls ' || relname || ' ' || relrowsecurity::text || ' ' || (select count(*) from pg_policy p where p.polrelid = c.oid)::text
      from pg_class c where relname in ('sample_ping_consents', 'sample_pings') and relkind = 'r'
  ) s`;

const BINDING = '66666666-6666-4666-8666-000000000001';
const CHILD = '77777777-7777-4777-8777-000000000001';
const TOMB = 'ab'.repeat(16);

d('the direct ping migration on a real Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqsp-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqp-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create role anon login; create role authenticated login; create role service_role login;');
    psql('create database mirror;');
    // the bindings the consent rows hang from (the migration this one requires)
    apply('child_identity.sql');
    apply('child_identity.sql', 'mirror');
    psql(`insert into child_phone_bindings (id, canonical_id, phone_tomb, via, confirmed_at, expires_at)
          values ('${BINDING}', '${CHILD}', '${TOMB}', 'save', now(), now() + interval '30 days')`);
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('the migration says what it requires', () => {
    expect(fs.readFileSync(path.join(MIG, 'web_quiz_sample_ping.sql'), 'utf8')).toMatch(/^-- requires: child_identity\.sql/);
  });

  test('applies twice cleanly (if not exists); both tables exist', () => {
    apply('web_quiz_sample_ping.sql');
    apply('web_quiz_sample_ping.sql');
    for (const t of TABLES) expect(psql(`select to_regclass('public.${t}') is not null`)).toBe('t');
  });

  test('the columns are exactly these: no phone, no name, no child id', () => {
    const cols = (t) => psql(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '${t}'`);
    expect(cols('sample_ping_consents')).toBe('binding_id,consent_v,consented_at');
    expect(cols('sample_pings')).toBe('id,term_code,phone_tomb,class_id,state,created_at,sent_at');
    const all = psql("select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public' and table_name in ('sample_ping_consents', 'sample_pings')").split(',');
    expect(all.filter((c) => /^phone$|phone_norm|phone_e164|name|student|child|canonical/.test(c))).toEqual([]);
  });

  test('RLS on, no policy, on both', () => {
    expect(psql("select string_agg(relname || ':' || relrowsecurity, ',' order by relname) from pg_class where relname in ('sample_ping_consents', 'sample_pings') and relkind = 'r'"))
      .toBe('sample_ping_consents:true,sample_pings:true');
    expect(psql("select count(*) from pg_policy where polrelid in ('public.sample_ping_consents'::regclass, 'public.sample_pings'::regclass)")).toBe('0');
  });

  test('one ping per (term_code, phone_tomb): a second row for the same pair is refused (23505); another term is fine', () => {
    psql(`insert into sample_pings (term_code, phone_tomb, state) values ('2026-27b', '${TOMB}', 'reserved')`);
    expect(fails(`insert into sample_pings (term_code, phone_tomb, state) values ('2026-27b', '${TOMB}', 'sent')`)).toMatch(/duplicate key value violates unique constraint/);
    expect(fails(`insert into sample_pings (term_code, phone_tomb, state) values ('2027-28a', '${TOMB}', 'reserved')`)).toBeNull();
    expect(psql("select count(*) from pg_constraint where conrelid = 'public.sample_pings'::regclass and contype = 'u'")).toBe('1');
  });

  test('state is reserved | sent | failed only; id and created_at default', () => {
    expect(fails(`insert into sample_pings (term_code, phone_tomb, state) values ('2026-27b', 'b1', 'queued')`)).toMatch(/check constraint/);
    expect(fails(`insert into sample_pings (term_code, phone_tomb, state) values ('2026-27b', 'b2', null)`)).toMatch(/not-null/);
    expect(fails(`insert into sample_pings (term_code, phone_tomb, state) values ('2026-27b', 'b3', 'failed')`)).toBeNull();
    expect(psql("select (id is not null) || ',' || (created_at is not null) || ',' || (sent_at is null) from sample_pings where phone_tomb = 'b3'")).toBe('true,true,true');
  });

  test('a consent row needs a real binding, consent_v ≥ 1, and goes with its binding (on delete cascade)', () => {
    expect(fails("insert into sample_ping_consents (binding_id, consent_v) values ('66666666-6666-4666-8666-000000000009', 1)")).toMatch(/foreign key/);
    expect(fails(`insert into sample_ping_consents (binding_id, consent_v) values ('${BINDING}', 0)`)).toMatch(/check constraint/);
    expect(fails(`insert into sample_ping_consents (binding_id, consent_v) values ('${BINDING}', 1)`)).toBeNull();
    expect(fails(`insert into sample_ping_consents (binding_id, consent_v) values ('${BINDING}', 2)`)).toMatch(/duplicate key/);
    expect(psql(`select consented_at is not null from sample_ping_consents where binding_id = '${BINDING}'`)).toBe('t');
    psql(`delete from child_phone_bindings where id = '${BINDING}'`);
    expect(psql('select count(*) from sample_ping_consents')).toBe('0');
  });

  test('the mirror block in 00_complete-schema.sql builds the same two tables', () => {
    const block = mirrorBlock();
    expect(block).not.toBeNull();
    const f = path.join(dir, 'mirror.sql');
    fs.writeFileSync(f, block);
    psql(null, { file: f, db: 'mirror' });
    psql(null, { file: f, db: 'mirror' });                     // the mirror re-runs too
    const mine = psql(FINGERPRINT);
    expect(mine.split('\n').length).toBeGreaterThan(10);
    expect(psql(FINGERPRINT, { db: 'mirror' })).toBe(mine);
  });

  test('the rollback drops these two tables and nothing else; it re-applies cleanly after', () => {
    const before = psql("select string_agg(relname, ',' order by relname) from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace");
    apply('web_quiz_sample_ping_rollback.sql');
    apply('web_quiz_sample_ping_rollback.sql');
    for (const t of TABLES) expect(psql(`select to_regclass('public.${t}') is null`)).toBe('t');
    const after = psql("select string_agg(relname, ',' order by relname) from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace");
    expect(after.split(',')).toEqual(before.split(',').filter((t) => !TABLES.includes(t)));
    expect(psql("select to_regclass('public.child_phone_bindings') is not null")).toBe('t');
    apply('web_quiz_sample_ping.sql');
    for (const t of TABLES) expect(psql(`select to_regclass('public.${t}') is not null`)).toBe('t');
  });

  test('the rollback names only these two tables', () => {
    const sql = fs.readFileSync(path.join(MIG, 'web_quiz_sample_ping_rollback.sql'), 'utf8').replace(/--.*$/gm, '');
    const dropped = [...sql.matchAll(/drop\s+table\s+if\s+exists\s+(?:public\.)?(\w+)/gi)].map((m) => m[1]).sort();
    expect(dropped).toEqual(TABLES);
    expect(sql).not.toMatch(/message_ledger|child_phone_bindings/i);
  });
});
