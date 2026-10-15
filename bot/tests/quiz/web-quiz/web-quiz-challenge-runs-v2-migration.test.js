'use strict';
/**
 * web_quiz_challenge_runs_v2.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no TCP).
 * The migration must apply twice cleanly, leave every existing row exactly as it was, keep an old-shape insert
 * working, accept the two new states and refuse values outside each CHECK; the rollback refuses while a served row
 * exists and otherwise restores the original status CHECK.
 *
 * Needs the Postgres server binaries (postgres, initdb, pg_ctl, psql: PG_BIN or pg_config --bindir); without them the
 * suite is skipped and says so.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MIG = path.join(__dirname, '..', '..', '..', 'database', 'migrations');
// A folder holding the whole server set (postgres beside initdb): PG_BIN, else pg_config --bindir, else common installs.
const binDir = (() => {
  const cands = [process.env.PG_BIN];
  try { cands.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* none */ }
  cands.push('/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/local/bin');
  return cands.find((c) => c && ['postgres', 'initdb', 'pg_ctl', 'psql'].every((b) => fs.existsSync(path.join(c, b)))) || null;
})();
const bin = (b) => path.join(binDir, b);
const PG = !!binDir;
const d = PG ? describe : describe.skip;
if (!PG) console.warn('web-quiz-challenge-runs-v2-migration: no Postgres server binaries found (set PG_BIN) — skipped');

let dir;
let sock;
const PORT = String(54000 + (process.pid % 900));
const psql = (sql, { file = null } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql) => { try { psql(sql); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f) => psql(null, { file: path.join(MIG, f) });

const OLD_ROW = "insert into web_quiz_challenge_runs (id, student_id, exercise, grade, lang, status, score, wcpm, meta, created_at, scored_at) values "
  + "('%ID%', '11111111-1111-4111-8111-111111111111', 'read', 3, 'en', 'scored', '{\"correct\":31}', 31, '{\"ms\":900}', '2026-10-01T10:00:00Z', '2026-10-01T10:01:00Z')";
const oldRow = (id) => OLD_ROW.replace('%ID%', id);
const BASE_COLS = 'id, student_id, exercise, grade, lang, status, score, wcpm, meta, created_at, scored_at';
const v2 = (id, extra) => {
  const cols = { status: 'served', ...extra };
  return `insert into web_quiz_challenge_runs (id, student_id, exercise, ${Object.keys(cols).map((k) => `"${k}"`).join(', ')}) `
    + `values ('${id}', '11111111-1111-4111-8111-111111111111', 'read', ${Object.values(cols).map((v) => `'${v}'`).join(', ')})`;
};

d('the runs migration on a real Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqrv2-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqs-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create table public.students (id uuid primary key)');
    psql("insert into students values ('11111111-1111-4111-8111-111111111111')");
    apply('web_quiz_challenge.sql');
    psql(oldRow('aaaaaaaa-0000-4000-8000-000000000001'));
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('applies twice cleanly; the existing row reads back byte-identical; every new column is NULL on it', () => {
    const before = psql(`select row_to_json(t) from (select ${BASE_COLS} from web_quiz_challenge_runs) t`);
    apply('web_quiz_challenge_runs_v2.sql');
    apply('web_quiz_challenge_runs_v2.sql');
    expect(psql(`select row_to_json(t) from (select ${BASE_COLS} from web_quiz_challenge_runs) t`)).toBe(before);
    const nulls = psql("select count(*) from web_quiz_challenge_runs where num_nonnulls(bank_version, \"set\", form, passage_id, item_set_id, mode, period_id, exposure_no, band, anchor_exposure_no, anchor_block, homonym_in_list, draw_seed, canonical_id, id_src, id_confidence, via, share_code_id, class_id, helped, record, scorer_v, started_at, audio_consent, audio_consent_at, audio_consent_by, audio_keep_until) = 0");
    expect(nulls).toBe('1');
    expect(psql("select count(*) from pg_constraint where conrelid = 'web_quiz_challenge_runs'::regclass and conname like 'wqcr_%'")).toBe('13');
    expect(psql("select count(*) from pg_indexes where indexname in ('web_quiz_challenge_runs_record_idx','web_quiz_challenge_runs_sweep_idx')")).toBe('2');
    expect(psql("select to_regclass('public.web_quiz_strip_weekly') is not null and to_regclass('public.child_rungs') is not null")).toBe('t');
  });

  test('an old-shape insert (no new column named) still succeeds', () => {
    expect(fails(oldRow('aaaaaaaa-0000-4000-8000-000000000002'))).toBeNull();
  });

  test('served and abandoned are accepted; every old state still is', () => {
    for (const [i, st] of ['served', 'abandoned', 'scoring', 'scored', 'failed'].entries()) {
      expect(fails(`insert into web_quiz_challenge_runs (id, student_id, exercise, status) values ('bbbbbbbb-0000-4000-8000-00000000000${i}', '11111111-1111-4111-8111-111111111111', 'read', '${st}')`)).toBeNull();
    }
  });

  test.each([
    ['an unknown status', { status: 'bogus' }],
    ['a period that is not a month', { period_id: '2026-13' }],
    ['an unknown mode', { mode: 'free' }],
    ['a band outside 1–3', { band: '4' }],
    ['an exposure below 1', { exposure_no: '0' }],
    ['an anchor block that does not exist', { anchor_block: 'B1' }],
    ['a two-valued help answer', { helped: 'yes' }],
    ['a keep date without the grown-up\'s kept_ok', { audio_consent: 'kept_no', audio_keep_until: '2027-01-01T00:00:00Z' }],
    ['a form that is not G1/G3/G5', { form: 'G4' }],
  ])('refuses %s', (_, extra) => {
    expect(fails(v2('cccccccc-0000-4000-8000-000000000001', extra))).toMatch(/check constraint/);
  });

  test('a full v2 row is accepted', () => {
    expect(fails(v2('cccccccc-0000-4000-8000-000000000002', {
      status: 'scored', mode: 'check', period_id: '2026-11', exposure_no: '1', band: '2', anchor_exposure_no: '1', anchor_block: 'A1',
      helped: 'self', id_confidence: 'high', form: 'G5', audio_consent: 'kept_ok', audio_keep_until: '2027-02-01T00:00:00Z', audio_consent_by: 'grownup_tap',
    }))).toBeNull();
  });

  test('the exercise CHECK is unchanged', () => {
    expect(fails("insert into web_quiz_challenge_runs (id, student_id, exercise, status) values ('dddddddd-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'spell', 'scored')")).toMatch(/check constraint/);
  });

  test('the rollback refuses while served/abandoned rows exist, then restores the original status CHECK', () => {
    expect(() => apply('web_quiz_challenge_runs_v2_rollback.sql')).toThrow(/served\/abandoned/);
    expect(psql("select count(*) from information_schema.columns where table_name = 'web_quiz_challenge_runs' and column_name = 'mode'")).toBe('1');
    psql("delete from web_quiz_challenge_runs where status in ('served','abandoned')");
    apply('web_quiz_challenge_runs_v2_rollback.sql');
    expect(psql("select count(*) from information_schema.columns where table_name = 'web_quiz_challenge_runs'")).toBe('11');
    expect(fails("insert into web_quiz_challenge_runs (id, student_id, exercise, status) values ('eeeeeeee-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'read', 'served')")).toMatch(/check constraint/);
    apply('web_quiz_challenge_runs_v2.sql');   // and forward again
    expect(psql("select count(*) from pg_constraint where conrelid = 'web_quiz_challenge_runs'::regclass and conname like 'wqcr_%'")).toBe('13');
  });
});
