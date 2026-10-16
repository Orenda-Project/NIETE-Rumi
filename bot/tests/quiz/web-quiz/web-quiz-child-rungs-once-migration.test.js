'use strict';
/**
 * web_quiz_child_rungs_once.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no TCP):
 * the nullable `stop` column (CHECK read | listen | missing | bigger) and the unique index that holds a child's lamp
 * to at most one change per ladder per stop per period. It must apply twice cleanly, refuse a second row for the
 * same child × ladder × stop × period, keep RLS on, take UPDATE and DELETE away from every API role (one row per rung
 * change, never updated: BADGES §2.2), and roll back cleanly (index, column and the two privileges only; before the
 * runs migration's own rollback).
 *
 * Needs the Postgres server binaries (postgres, initdb, pg_ctl, psql: PG_BIN or pg_config --bindir); without them the
 * suite is skipped and says so.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MIG = path.join(__dirname, '..', '..', '..', 'database', 'migrations');
const binDir = (() => {
  const cands = [process.env.PG_BIN];
  try { cands.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* none */ }
  cands.push('/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/local/bin');
  return cands.find((c) => c && ['postgres', 'initdb', 'pg_ctl', 'psql'].every((b) => fs.existsSync(path.join(c, b)))) || null;
})();
const bin = (b) => path.join(binDir, b);
const PG = !!binDir;
const d = PG ? describe : describe.skip;
if (!PG) console.warn('web-quiz-child-rungs-once-migration: no Postgres server binaries found (set PG_BIN) — skipped');

let dir;
let sock;
const PORT = String(55000 + (process.pid % 900));
const psql = (sql, { file = null } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const psqlAs = (user, sql) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', user, '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql,
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql, { user = null } = {}) => { try { if (user) psqlAs(user, sql); else psql(sql); return null; } catch (e) { return String(e.stderr || e.message); } };
const ROLES = ['service_role', 'authenticated', 'anon'];
const can = (role, priv) => psql(`select has_table_privilege('${role}', 'public.child_rungs', '${priv}')`);
const apply = (f) => psql(null, { file: path.join(MIG, f) });

const KID = '11111111-1111-4111-8111-111111111111';
const lamp = (ladder, rung, period, stop = 'read', kid = KID) => `insert into child_rungs (canonical_id, ladder, rung, rule_v, stop, period_id) values ('${kid}', '${ladder}', ${rung}, 'badges-v1', ${stop == null ? 'NULL' : `'${stop}'`}, '${period}')`;
const hasStop = () => psql("select count(*) from information_schema.columns where table_name = 'child_rungs' and column_name = 'stop'");
const INDEX = 'child_rungs_once_per_stop_idx';

d('the lamps once-per-period migration on a real Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqcr1-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqs1-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    // Supabase's API roles and its default grants (ALL on every new public table and sequence; service_role bypasses RLS).
    psql('create role anon login; create role authenticated login; create role service_role login bypassrls;');
    psql('grant usage on schema public to anon, authenticated, service_role; alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;');
    psql('create table public.students (id uuid primary key)');
    apply('web_quiz_challenge.sql');
    apply('web_quiz_challenge_runs_v2.sql');
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('applies twice cleanly; a nullable text stop column; one unique index on (canonical_id, ladder, stop, period_id); RLS stays on', () => {
    expect(hasStop()).toBe('0');
    apply('web_quiz_child_rungs_once.sql');
    apply('web_quiz_child_rungs_once.sql');
    expect(psql("select data_type || '|' || is_nullable from information_schema.columns where table_name = 'child_rungs' and column_name = 'stop'")).toBe('text|YES');
    expect(psql("select count(*) from pg_constraint where conrelid = 'public.child_rungs'::regclass and conname = 'child_rungs_stop_chk'")).toBe('1');
    expect(psql(`select indexdef from pg_indexes where indexname = '${INDEX}'`))
      .toMatch(/CREATE UNIQUE INDEX child_rungs_once_per_stop_idx ON public\.child_rungs USING btree \(canonical_id, ladder, stop, period_id\)/);
    expect(psql(`select count(*) from pg_indexes where tablename = 'child_rungs' and indexname = '${INDEX}'`)).toBe('1');
    expect(psql("select relrowsecurity from pg_class where oid = 'public.child_rungs'::regclass")).toBe('t');
  });

  test('the stop CHECK: NULL passes, a name that is not a stop is refused (the four stops land below)', () => {
    expect(fails(lamp('reading', 1, '2026-01', 'spell'))).toMatch(/check constraint "child_rungs_stop_chk"/);
    expect(fails(lamp('reading', 1, '2026-01', null))).toBeNull();
    psql('delete from child_rungs');
  });

  test('the file names what it needs first: a "-- requires:" header line with the runs migration that creates child_rungs', () => {
    const first = fs.readFileSync(path.join(MIG, 'web_quiz_child_rungs_once.sql'), 'utf8').split('\n')[0];
    expect(first).toMatch(/^-- requires: .*web_quiz_challenge_runs_v2\.sql/);
  });

  test('never updated: UPDATE and DELETE are refused for service_role, authenticated and anon; the job\'s INSERT and SELECT still work', () => {
    for (const role of ROLES) {
      expect(can(role, 'UPDATE')).toBe('f');
      expect(can(role, 'DELETE')).toBe('f');
    }
    expect(can('service_role', 'INSERT')).toBe('t');
    expect(can('service_role', 'SELECT')).toBe('t');
    expect(fails(lamp('reading', 2, '2030-01', 'read', '33333333-3333-4333-8333-333333333333'), { user: 'service_role' })).toBeNull();
    expect(fails("update child_rungs set rung = 5 where canonical_id = '33333333-3333-4333-8333-333333333333'", { user: 'service_role' }))
      .toMatch(/permission denied for table child_rungs/);
    expect(fails("delete from child_rungs where canonical_id = '33333333-3333-4333-8333-333333333333'", { user: 'service_role' }))
      .toMatch(/permission denied for table child_rungs/);
    expect(psqlAs('service_role', "select rung from child_rungs where canonical_id = '33333333-3333-4333-8333-333333333333'")).toBe('2');
    psql("delete from child_rungs where canonical_id = '33333333-3333-4333-8333-333333333333'");   // the owner, test cleanup only
  });

  test('a second row for the same child × ladder × stop × period is refused; another stop, ladder, period or child is not', () => {
    expect(fails(lamp('reading', 1, '2026-11', 'listen'))).toBeNull();
    expect(fails(lamp('reading', 3, '2026-11', 'read'))).toBeNull();         // listen then read, one month: both land
    expect(fails(lamp('reading', 4, '2026-11', 'read'))).toMatch(/duplicate key value violates unique constraint "child_rungs_once_per_stop_idx"/);
    expect(fails(lamp('numbers', 2, '2026-11', 'missing'))).toBeNull();
    expect(fails(lamp('reading', 4, '2026-12', 'read'))).toBeNull();
    expect(fails(lamp('reading', 1, '2026-11', 'read', '22222222-2222-4222-8222-222222222222'))).toBeNull();
    expect(psql('select count(*) from child_rungs')).toBe('5');
  });

  test('the rollback drops only the index and the column and gives UPDATE / DELETE back, twice cleanly; then the runs rollback still runs; then both forward again', () => {
    apply('web_quiz_child_rungs_once_rollback.sql');
    apply('web_quiz_child_rungs_once_rollback.sql');
    for (const role of ROLES) {
      expect(can(role, 'UPDATE')).toBe('t');
      expect(can(role, 'DELETE')).toBe('t');
    }
    expect(psql(`select count(*) from pg_indexes where indexname = '${INDEX}'`)).toBe('0');
    expect(hasStop()).toBe('0');
    expect(psql('select count(*) from child_rungs')).toBe('5');
    expect(psql("select count(*) from pg_indexes where indexname = 'child_rungs_child_idx'")).toBe('1');
    expect(fails("insert into child_rungs (canonical_id, ladder, rung, rule_v, period_id) values ('11111111-1111-4111-8111-111111111111', 'reading', 5, 'badges-v1', '2026-11')")).toBeNull();
    apply('web_quiz_challenge_runs_v2_rollback.sql');
    expect(psql("select to_regclass('public.child_rungs') is null")).toBe('t');
    apply('web_quiz_challenge_runs_v2.sql');
    apply('web_quiz_child_rungs_once.sql');
    expect(psql(`select count(*) from pg_indexes where indexname = '${INDEX}'`)).toBe('1');
    expect(can('service_role', 'UPDATE')).toBe('f');
  });
});
