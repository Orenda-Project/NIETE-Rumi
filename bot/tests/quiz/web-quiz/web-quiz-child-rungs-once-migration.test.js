'use strict';
/**
 * web_quiz_child_rungs_once.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no TCP):
 * the unique index that holds a child's lamp to at most one change per ladder per period. It must apply twice
 * cleanly, refuse a second row for the same child × ladder × period, keep RLS on, and roll back cleanly (and before
 * the runs migration's own rollback).
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
const fails = (sql) => { try { psql(sql); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f) => psql(null, { file: path.join(MIG, f) });

const KID = '11111111-1111-4111-8111-111111111111';
const lamp = (ladder, rung, period, kid = KID) => `insert into child_rungs (canonical_id, ladder, rung, rule_v, period_id) values ('${kid}', '${ladder}', ${rung}, 'badges-v1', '${period}')`;
const INDEX = 'child_rungs_once_per_period_idx';

d('the lamps once-per-period migration on a real Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqcr1-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqs1-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
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

  test('applies twice cleanly; one unique index on (canonical_id, ladder, period_id); RLS stays on', () => {
    apply('web_quiz_child_rungs_once.sql');
    apply('web_quiz_child_rungs_once.sql');
    expect(psql(`select indexdef from pg_indexes where indexname = '${INDEX}'`))
      .toMatch(/CREATE UNIQUE INDEX child_rungs_once_per_period_idx ON public\.child_rungs USING btree \(canonical_id, ladder, period_id\)/);
    expect(psql(`select count(*) from pg_indexes where tablename = 'child_rungs' and indexname = '${INDEX}'`)).toBe('1');
    expect(psql("select relrowsecurity from pg_class where oid = 'public.child_rungs'::regclass")).toBe('t');
  });

  test('a second row for the same child × ladder × period is refused; another ladder, period or child is not', () => {
    expect(fails(lamp('reading', 1, '2026-11'))).toBeNull();
    expect(fails(lamp('reading', 3, '2026-11'))).toMatch(/duplicate key value violates unique constraint "child_rungs_once_per_period_idx"/);
    expect(fails(lamp('numbers', 2, '2026-11'))).toBeNull();
    expect(fails(lamp('reading', 3, '2026-12'))).toBeNull();
    expect(fails(lamp('reading', 1, '2026-11', '22222222-2222-4222-8222-222222222222'))).toBeNull();
    expect(psql('select count(*) from child_rungs')).toBe('4');
  });

  test('the rollback drops only the index, twice cleanly; then the runs rollback still runs; then both forward again', () => {
    apply('web_quiz_child_rungs_once_rollback.sql');
    apply('web_quiz_child_rungs_once_rollback.sql');
    expect(psql(`select count(*) from pg_indexes where indexname = '${INDEX}'`)).toBe('0');
    expect(psql('select count(*) from child_rungs')).toBe('4');
    expect(psql("select count(*) from pg_indexes where indexname = 'child_rungs_child_idx'")).toBe('1');
    expect(fails(lamp('reading', 3, '2026-11'))).toBeNull();          // no longer refused
    apply('web_quiz_challenge_runs_v2_rollback.sql');
    expect(psql("select to_regclass('public.child_rungs') is null")).toBe('t');
    apply('web_quiz_challenge_runs_v2.sql');
    apply('web_quiz_child_rungs_once.sql');
    expect(psql(`select count(*) from pg_indexes where indexname = '${INDEX}'`)).toBe('1');
  });
});
