'use strict';
/**
 * web_quiz_challenge_runs_record_locks.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no TCP).
 * The record ("one record per canonical child × stop × period", per language for read and listen) is decided by a read
 * at serve time and inserted later; two concurrent serves could both insert record = true. The migration makes the
 * database refuse the second one (23505), adds six CHECKs (one: a record row carries its whole key) on the serve's columns and tightens the first-exposure rule
 * (23514). Applies twice cleanly, leaves existing rows as they were; the rollback puts the table back exactly as before.
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
if (!binDir) console.warn('web-quiz-challenge-runs-record-locks-migration: no Postgres server binaries found (set PG_BIN) — skipped');

let dir;
let sock;
const PORT = String(57000 + (process.pid % 900));
// VERBOSITY=verbose: psql prints the SQLSTATE ("ERROR:  23505: ...") so the tests can assert the code itself
const psql = (sql, { file = null } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql) => { try { psql(sql); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f) => psql(null, { file: path.join(MIG, f) });

const KID = '11111111-1111-4111-8111-111111111111';
const KID2 = '22222222-2222-4222-8222-222222222222';
const LEGACY = 'aaaaaaaa-0000-4000-8000-000000000001';
const BASE_COLS = 'id, student_id, exercise, grade, lang, status, score, wcpm, meta, created_at, scored_at';
let seq = 0;
// a served record row as the v2 serve writes it; `cols` overrides (null → SQL NULL)
const ins = (cols = {}) => {
  seq += 1;
  const all = { id: `bbbbbbbb-0000-4000-8000-${String(seq).padStart(12, '0')}`, student_id: KID, canonical_id: KID, exercise: 'read', lang: 'en',
    status: 'served', mode: 'check', record: 'true', period_id: '2026-11', form: 'G3', bank_version: 'bank-v4', exposure_no: '1',
    admin_mode: 'self_run', ...cols };
  return `insert into web_quiz_challenge_runs (${Object.keys(all).map((k) => `"${k}"`).join(', ')}) values (${Object.values(all).map((v) => (v === null ? 'null' : `'${v}'`)).join(', ')})`;
};
const clear = () => psql(`delete from web_quiz_challenge_runs where id <> '${LEGACY}'`);
// the table's shape: columns, constraints (with their definitions) and indexes
const shape = () => psql("select string_agg(x, E'\\n' order by x) from ("
  + "select 'col ' || column_name || ' ' || data_type x from information_schema.columns where table_name = 'web_quiz_challenge_runs' "
  + "union all select 'con ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'web_quiz_challenge_runs'::regclass "
  + "union all select 'idx ' || indexname || ' ' || indexdef from pg_indexes where tablename = 'web_quiz_challenge_runs') t");
const LOCK_IDX = ['web_quiz_challenge_runs_one_record_lang_uidx', 'web_quiz_challenge_runs_one_record_stop_uidx'];
const LOCK_CHK = ['wqcr_anchor_block_stop_chk', 'wqcr_serves_any_needs_block_chk', 'wqcr_class_round_arm_chk', 'wqcr_class_round_admin_chk', 'wqcr_record_provenance_chk', 'wqcr_record_key_not_null_chk'];

d('the record locks on a real Postgres', () => {
  let before;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqrl-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqrls-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create table public.students (id uuid primary key)');
    psql(`insert into students values ('${KID}'), ('${KID2}')`);
    apply('web_quiz_challenge.sql');
    apply('web_quiz_challenge_runs_v2.sql');
    apply('web_quiz_challenge_runs_sampling.sql');
    psql(`insert into web_quiz_challenge_runs (${BASE_COLS}) values ('${LEGACY}', '${KID}', 'read', 3, 'en', 'scored', '{"correct":31}', 31, '{"ms":900}', '2026-10-01T10:00:00Z', '2026-10-01T10:01:00Z')`);
    before = shape();
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('applies twice cleanly; the existing row reads back byte-identical; the two indexes and the CHECKs exist', () => {
    const row = psql(`select row_to_json(t) from (select ${BASE_COLS} from web_quiz_challenge_runs) t`);
    apply('web_quiz_challenge_runs_record_locks.sql');
    apply('web_quiz_challenge_runs_record_locks.sql');
    expect(psql(`select row_to_json(t) from (select ${BASE_COLS} from web_quiz_challenge_runs) t`)).toBe(row);
    expect(psql(`select count(*) from pg_indexes where indexname in (${LOCK_IDX.map((n) => `'${n}'`).join(', ')}) and indexdef like 'CREATE UNIQUE INDEX%'`)).toBe('2');
    expect(psql(`select count(*) from pg_constraint where conrelid = 'web_quiz_challenge_runs'::regclass and conname in (${LOCK_CHK.map((n) => `'${n}'`).join(', ')}) and convalidated`)).toBe('6');
    expect(psql("select count(*) from pg_constraint where conname = 'wqcr_record_first_exposure_chk'")).toBe('1');
  });

  describe('one record per canonical child × stop × period', () => {
    beforeEach(clear);

    test('two record rows for one child × read × en × period: the second is refused (23505)', () => {
      expect(fails(ins())).toBeNull();
      expect(fails(ins({ status: 'scored' }))).toMatch(/23505/);
    });

    test('the same for a maths stop, with no language in the key (23505)', () => {
      expect(fails(ins({ exercise: 'bigger', lang: 'en' }))).toBeNull();
      expect(fails(ins({ exercise: 'bigger', lang: 'ur' }))).toMatch(/23505/);
      expect(fails(ins({ exercise: 'numbers', form: 'G1', anchor_block: 'G1A', anchor_serves_any: '1', lang: null }))).toBeNull();
      expect(fails(ins({ exercise: 'numbers', form: 'G1', anchor_block: 'G1A', anchor_serves_any: '2', exposure_no: '2', lang: null }))).toMatch(/23505/);
    });

    test('record false (practice) and record NULL duplicates are allowed', () => {
      expect(fails(ins())).toBeNull();
      expect(fails(ins({ mode: 'practice', record: 'false' }))).toBeNull();
      expect(fails(ins({ mode: 'practice', record: 'false' }))).toBeNull();
      expect(fails(ins({ mode: null, record: null, period_id: null }))).toBeNull();
      expect(fails(ins({ mode: null, record: null, period_id: null }))).toBeNull();
    });

    test('a different language, stop or period is its own record', () => {
      expect(fails(ins())).toBeNull();
      expect(fails(ins({ lang: 'ur' }))).toBeNull();
      expect(fails(ins({ exercise: 'listen' }))).toBeNull();
      expect(fails(ins({ period_id: '2026-12' }))).toBeNull();
      expect(fails(ins({ exercise: 'bigger' }))).toBeNull();
      expect(fails(ins({ exercise: 'bigger', period_id: '2026-12' }))).toBeNull();
    });

    test('another child is not blocked', () => {
      expect(fails(ins())).toBeNull();
      expect(fails(ins({ student_id: KID2, canonical_id: KID2 }))).toBeNull();
    });

    test('a NULL canonical id falls back to the student id', () => {
      expect(fails(ins({ canonical_id: null }))).toBeNull();
      expect(fails(ins({ canonical_id: null }))).toMatch(/23505/);
      // a row of the second login folded onto the first child collides with the first child's own row
      expect(fails(ins({ student_id: KID2, canonical_id: KID }))).toMatch(/23505/);
    });
  });

  describe('the CHECKs (23514 for a violating row; the valid row accepted)', () => {
    beforeEach(clear);

    test.each([
      ['an anchor block on a stop that has none', { anchor_block: 'A1', anchor_serves_any: '1' }, { exercise: 'missing', anchor_block: 'A1', anchor_serves_any: '1' }],
      ['anchor serves without an anchor block', { exercise: 'missing', anchor_serves_any: '1' }, { exercise: 'missing', anchor_block: 'A1', anchor_serves_any: '1' }],
      ['a class round turn outside the class_round arm', { mode: 'class_round', record: 'false', admin_mode: 'teacher_present', sample_arm: 'coach' },
        { mode: 'class_round', record: 'false', admin_mode: 'teacher_present', sample_arm: 'class_round' }],
      ['a class round turn with no arm at all', { mode: 'class_round', record: 'false', admin_mode: 'teacher_present', sample_arm: null },
        { mode: 'practice', record: 'false', admin_mode: 'teacher_present', sample_arm: null }],
      ['the class_round arm without a teacher present', { mode: 'class_round', record: 'false', admin_mode: 'self_run', sample_arm: 'class_round' },
        { mode: 'class_round', record: 'false', admin_mode: 'teacher_present', sample_arm: 'class_round' }],
      ['a record row without a form', { form: null }, { form: 'G5' }],
      ['a record row without a bank version', { bank_version: null }, { bank_version: 'bank-v3' }],
      ['a record row with no exposure count', { exposure_no: null }, { exposure_no: '1' }],
      ['a record row on a second exposure', { exposure_no: '2' }, { exposure_no: '1' }],
      ['a record row with no period', { period_id: null }, { period_id: '2026-11' }],
      ['a reading record row with no language', { lang: null }, { lang: 'ur' }],
      ['a listening record row with no language', { exercise: 'listen', lang: null }, { exercise: 'listen', lang: 'en' }],
    ])('refuses %s', (_, bad, good) => {
      expect(fails(ins(bad))).toMatch(/23514/);
      expect(fails(ins(good))).toBeNull();
    });

    test('an anchor block record is exempt from the first-exposure rule; non-record rows pass every record CHECK', () => {
      expect(fails(ins({ exercise: 'missing', anchor_block: 'A1', anchor_serves_any: '3', exposure_no: '3' }))).toBeNull();
      expect(fails(ins({ mode: 'practice', record: 'false', form: null, bank_version: null, exposure_no: null }))).toBeNull();
      // the record key: a maths record row needs no language; a non-record row needs no period or language
      expect(fails(ins({ exercise: 'bigger', lang: null }))).toBeNull();
      expect(fails(ins({ mode: 'practice', record: 'false', period_id: null, lang: null }))).toBeNull();
      // the child part of the key: student_id is NOT NULL, so coalesce(canonical_id, student_id) is never NULL (23502 first)
      expect(fails(ins({ canonical_id: null, student_id: null, period_id: '2026-12' }))).toMatch(/23502/);
    });
  });

  test('the rollback leaves the table exactly as before (the first-exposure rule restored); refused on duplicates; re-runnable', () => {
    clear();
    apply('web_quiz_challenge_runs_record_locks_rollback.sql');
    apply('web_quiz_challenge_runs_record_locks_rollback.sql');
    expect(shape()).toBe(before);
    expect(psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'wqcr_record_first_exposure_chk'")).toMatch(/exposure_no IS NULL/);
    // existing duplicate records: the migration fails whole and leaves nothing half-applied
    psql(ins()); psql(ins());
    expect(() => apply('web_quiz_challenge_runs_record_locks.sql')).toThrow(/23505/);
    expect(shape()).toBe(before);
    clear();
    apply('web_quiz_challenge_runs_record_locks.sql');
    expect(psql(`select count(*) from pg_indexes where indexname in (${LOCK_IDX.map((n) => `'${n}'`).join(', ')})`)).toBe('2');
  });
});
