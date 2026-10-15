'use strict';
/**
 * web_quiz_challenge_runs_sampling.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no TCP).
 * Three nullable columns: the run's drawn sample (sample_arm), how it was administered (admin_mode), and every serve of
 * the anchor items in any mode (anchor_serves_any). Applies twice cleanly; leaves the existing row as it was; an
 * old-shape insert still works; a sampled run without its administration mode, an unknown arm or mode, and a serve count
 * below 1 are refused; the rollback removes it all.
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
const d = binDir ? describe : describe.skip;
if (!binDir) console.warn('web-quiz-challenge-runs-sampling-migration: no Postgres server binaries found (set PG_BIN) — skipped');

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
const BASE_COLS = 'id, student_id, exercise, grade, lang, status, score, wcpm, meta, created_at, scored_at';
let seq = 0;
const ins = (cols) => {
  seq += 1;
  const all = { id: `aaaaaaaa-0000-4000-8000-${String(seq).padStart(12, '0')}`, student_id: KID, exercise: 'missing', status: 'scored', ...cols };
  return `insert into web_quiz_challenge_runs (${Object.keys(all).join(', ')}) values (${Object.values(all).map((v) => (v === null ? 'null' : `'${v}'`)).join(', ')})`;
};

d('the sampling columns on a real Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqsmp-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqss-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create table public.students (id uuid primary key)');
    psql(`insert into students values ('${KID}')`);
    apply('web_quiz_challenge.sql');
    psql(ins({ grade: 3, lang: 'en', score: '{"correct":8}', meta: '{"ms":900}', created_at: '2026-10-01T10:00:00Z' }));
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('applies twice cleanly; the existing row reads back byte-identical with the three columns NULL', () => {
    const before = psql(`select row_to_json(t) from (select ${BASE_COLS} from web_quiz_challenge_runs) t`);
    apply('web_quiz_challenge_runs_sampling.sql');
    apply('web_quiz_challenge_runs_sampling.sql');
    expect(psql(`select row_to_json(t) from (select ${BASE_COLS} from web_quiz_challenge_runs) t`)).toBe(before);
    expect(psql('select count(*) from web_quiz_challenge_runs where num_nonnulls(sample_arm, admin_mode, anchor_serves_any) = 0')).toBe('1');
    expect(psql("select count(*) from pg_constraint where conrelid = 'web_quiz_challenge_runs'::regclass and conname in ('wqcr_sample_arm_chk','wqcr_admin_mode_chk','wqcr_arm_needs_admin_chk','wqcr_serves_any_chk')")).toBe('4');
  });

  test('an old-shape insert still succeeds', () => {
    expect(fails(ins({}))).toBeNull();
  });

  test('a sampled run with its administration mode, a self-chosen run, and an anchor serve count are accepted', () => {
    expect(fails(ins({ sample_arm: 'class_round', admin_mode: 'teacher_present', anchor_serves_any: '2' }))).toBeNull();
    expect(fails(ins({ sample_arm: 'class_week', admin_mode: 'self_run', anchor_serves_any: '1' }))).toBeNull();
    expect(fails(ins({ sample_arm: null, admin_mode: 'self_run', anchor_serves_any: '1' }))).toBeNull();
  });

  test.each([
    ['a sampled run without its administration mode', { sample_arm: 'class_round' }],
    ['an unknown arm', { sample_arm: 'panel', admin_mode: 'self_run' }],
    ['an unknown administration mode', { admin_mode: 'parent_present' }],
    ['an anchor serve count below 1', { anchor_serves_any: '0' }],
  ])('refuses %s', (_, cols) => {
    expect(fails(ins(cols))).toMatch(/check constraint/);
  });

  test('the rollback removes the columns and their checks', () => {
    psql('delete from web_quiz_challenge_runs where sample_arm is not null or admin_mode is not null or anchor_serves_any is not null');
    apply('web_quiz_challenge_runs_sampling_rollback.sql');
    expect(psql("select count(*) from information_schema.columns where table_name = 'web_quiz_challenge_runs' and column_name in ('sample_arm','admin_mode','anchor_serves_any')")).toBe('0');
    expect(psql("select count(*) from pg_constraint where conname like 'wqcr_%'")).toBe('0');
  });
});
