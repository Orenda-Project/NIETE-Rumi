'use strict';
/**
 * web_quiz_challenge_runs_notice_shown.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no
 * TCP): the run row's `audio_consent` CHECK (wqcr_audio_consent_chk, made by web_quiz_challenge_runs_v2.sql) widened
 * to admit `notice_shown` (the mic NOTICE, RULING #96(4)) and `audio_consent_by` (wqcr_audio_by_chk) to admit
 * `notice_tap` (RULING #125: a notice row never says a grown-up tapped), every earlier value still admitted, anything
 * else still refused. It must apply twice cleanly, leave exactly one constraint of that name, and roll back to the three earlier
 * values without touching a row (the restored CHECK is NOT VALID, so rows written meanwhile stay). The schema mirror
 * (00_complete-schema.sql) carries the same widened CHECK.
 *
 * Needs the Postgres server binaries (postgres, initdb, pg_ctl, psql: PG_BIN or pg_config --bindir); without them the
 * suite is skipped and says so (the mirror test still runs).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MIG = path.join(__dirname, '..', '..', '..', 'database', 'migrations');
const SCHEMA = path.join(__dirname, '..', '..', '..', '..', 'infrastructure', 'supabase', '00_complete-schema.sql');
const binDir = (() => {
  const cands = [process.env.PG_BIN];
  try { cands.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* none */ }
  cands.push('/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/local/bin');
  return cands.find((c) => c && ['postgres', 'initdb', 'pg_ctl', 'psql'].every((b) => fs.existsSync(path.join(c, b)))) || null;
})();
const bin = (b) => path.join(binDir, b);
const PG = !!binDir;
const d = PG ? describe : describe.skip;
if (!PG) console.warn('web-quiz-challenge-runs-notice-migration: no Postgres server binaries found (set PG_BIN) — skipped');

let dir;
let sock;
const PORT = String(56000 + (process.pid % 900));
const psql = (sql, { file = null } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql) => { try { psql(sql); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f) => psql(null, { file: path.join(MIG, f) });

const KID = '11111111-1111-4111-8111-111111111111';
let n = 0;
const row = (consent, by = 'grownup_tap') => {
  n += 1;
  return `insert into web_quiz_challenge_runs (id, student_id, exercise, status, audio_consent, audio_consent_by) values ('aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}', '${KID}', 'read', 'scored', '${consent}', '${by}')`;
};
const named = () => psql("select count(*) from pg_constraint where conrelid = 'public.web_quiz_challenge_runs'::regclass and conname = 'wqcr_audio_consent_chk'");
const def = (name = 'wqcr_audio_consent_chk') => psql(`select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.web_quiz_challenge_runs'::regclass and conname = '${name}'`);
const namedBy = () => psql("select count(*) from pg_constraint where conrelid = 'public.web_quiz_challenge_runs'::regclass and conname = 'wqcr_audio_by_chk'");

d('the notice_shown migration on a real Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqnot-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqsn-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create table public.students (id uuid primary key)');
    psql(`insert into students values ('${KID}')`);
    apply('web_quiz_challenge.sql');
    apply('web_quiz_challenge_runs_v2.sql');
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('before it, notice_shown is refused by the runs CHECK, and notice_tap by the who-tapped CHECK', () => {
    expect(fails(row('notice_shown'))).toMatch(/wqcr_audio_consent_chk/);
    expect(fails(row('not_asked', 'notice_tap'))).toMatch(/wqcr_audio_by_chk/);
  });

  test('applies twice cleanly; one constraint of the same name; notice_shown and every earlier value admitted, anything else refused', () => {
    psql(row('kept_ok'));
    apply('web_quiz_challenge_runs_notice_shown.sql');
    apply('web_quiz_challenge_runs_notice_shown.sql');
    expect(named()).toBe('1');
    expect(def()).toMatch(/notice_shown/);
    for (const v of ['notice_shown', 'kept_ok', 'kept_no', 'not_asked']) expect(fails(row(v))).toBeNull();
    expect(fails(row('yes'))).toMatch(/wqcr_audio_consent_chk/);
    // a notice row says the child tapped the notice (RULING #125), never that a grown-up answered
    expect(namedBy()).toBe('1');
    expect(def('wqcr_audio_by_chk')).toMatch(/notice_tap/);
    expect(fails(row('notice_shown', 'notice_tap'))).toBeNull();
    expect(fails(row('kept_ok', 'grownup_tap'))).toBeNull();
    expect(fails(row('notice_shown', 'someone'))).toMatch(/wqcr_audio_by_chk/);
    // the keep-date rule is untouched: a keep date still needs kept_ok
    expect(fails(`insert into web_quiz_challenge_runs (id, student_id, exercise, status, audio_consent, audio_keep_until) values ('bbbbbbbb-0000-4000-8000-000000000001', '${KID}', 'read', 'scored', 'notice_shown', '2027-01-01T00:00:00Z')`)).toMatch(/wqcr_keep_needs_ok_chk/);
  });

  test('the rollback restores the three earlier values without touching a row; then the runs rollback still runs', () => {
    const before = psql('select count(*) from web_quiz_challenge_runs');
    apply('web_quiz_challenge_runs_notice_shown_rollback.sql');
    apply('web_quiz_challenge_runs_notice_shown_rollback.sql');
    expect(psql('select count(*) from web_quiz_challenge_runs')).toBe(before);
    expect(psql("select count(*) from web_quiz_challenge_runs where audio_consent = 'notice_shown'")).toBe('2');
    expect(named()).toBe('1');
    expect(def()).not.toMatch(/notice_shown/);
    expect(fails(row('notice_shown'))).toMatch(/wqcr_audio_consent_chk/);
    expect(psql("select count(*) from web_quiz_challenge_runs where audio_consent_by = 'notice_tap'")).toBe('1');
    expect(namedBy()).toBe('1');
    expect(def('wqcr_audio_by_chk')).not.toMatch(/notice_tap/);
    expect(fails(row('not_asked', 'notice_tap'))).toMatch(/wqcr_audio_by_chk/);
    apply('web_quiz_challenge_runs_notice_shown.sql');   // and forward again
    expect(def()).toMatch(/notice_shown/);
    expect(def('wqcr_audio_by_chk')).toMatch(/notice_tap/);
    apply('web_quiz_challenge_runs_notice_shown_rollback.sql');
    psql("delete from web_quiz_challenge_runs where status in ('served','abandoned')");
    apply('web_quiz_challenge_runs_v2_rollback.sql');
    expect(psql("select count(*) from information_schema.columns where table_name = 'web_quiz_challenge_runs' and column_name = 'audio_consent'")).toBe('0');
  });
});

describe('the schema mirror carries the widened CHECK', () => {
  test('00_complete-schema.sql admits notice_shown in wqcr_audio_consent_chk', () => {
    const sql = fs.readFileSync(SCHEMA, 'utf8');
    expect(sql).toMatch(/wqcr_audio_consent_chk[^\n]*CHECK \(audio_consent IN \('kept_ok', ?'kept_no', ?'not_asked', ?'notice_shown'\)\)/);
  });
  test('00_complete-schema.sql admits notice_tap in wqcr_audio_by_chk', () => {
    const sql = fs.readFileSync(SCHEMA, 'utf8');
    expect(sql).toMatch(/wqcr_audio_by_chk[^\n]*CHECK \(audio_consent_by IN \('grownup_tap', ?'notice_tap'\)\)/);
  });
  test('the migration names the one that made the column', () => {
    const sql = fs.readFileSync(path.join(MIG, 'web_quiz_challenge_runs_notice_shown.sql'), 'utf8');
    expect(sql).toMatch(/^-- requires: web_quiz_challenge_runs_v2\.sql/m);
  });
});
