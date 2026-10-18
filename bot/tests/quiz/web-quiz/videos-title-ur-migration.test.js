'use strict';
/**
 * web_quiz_student_videos_title_ur.sql (a lesson's and its chapter's Urdu-script names) on a real, throwaway Postgres
 * (initdb in a temp folder, a unix socket, no TCP), and the same statements in infrastructure/supabase/00_complete-schema.sql,
 * byte for byte. Two nullable text columns; applies twice cleanly; the rollback removes both and nothing else.
 * Needs the Postgres server binaries (PG_BIN or pg_config --bindir); without them the Postgres part is skipped and says so.
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
const d = binDir ? describe : describe.skip;
if (!binDir) console.warn('videos-title-ur-migration: no Postgres server binaries found (set PG_BIN) — the Postgres part is skipped');

// ── the mirror: each migration's statements appear in the schema file exactly ─────────────────────────────────────
const between = (sql, first, last) => {
  const t = sql.indexOf(first);
  const e = t >= 0 ? sql.indexOf(last, t) : -1;
  return t >= 0 && e > t ? sql.slice(t, e + last.length) : null;
};
const COLS = ['ALTER TABLE student_videos ADD COLUMN IF NOT EXISTS title_ur text;', 'ALTER TABLE student_videos ADD COLUMN IF NOT EXISTS chapter_ur text;'];

test('the schema file mirrors the two Urdu-name columns byte for byte', () => {
  const mig = between(fs.readFileSync(path.join(MIG, 'web_quiz_student_videos_title_ur.sql'), 'utf8'), ...COLS);
  expect(mig).toBeTruthy();
  expect(between(fs.readFileSync(SCHEMA, 'utf8'), ...COLS)).toBe(mig);
});

let dir;
let sock;
const PORT = String(58000 + (process.pid % 900));
const psql = (sql, { file = null } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql) => { try { psql(sql); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f) => psql(null, { file: path.join(MIG, f) });

d('on Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqvt-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqvs-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create table public.student_videos (id uuid primary key default gen_random_uuid(), grade varchar(50), clean_title text)');
    psql("insert into student_videos (grade, clean_title) values ('1', 'Muzakar Aur Mounas')");
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('applies twice cleanly: two nullable text columns, existing rows untouched (NULL = no Urdu name)', () => {
    apply('web_quiz_student_videos_title_ur.sql');
    apply('web_quiz_student_videos_title_ur.sql');
    expect(psql("select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name) from information_schema.columns where table_name = 'student_videos' and column_name in ('title_ur', 'chapter_ur')")).toBe('chapter_ur:text:YES,title_ur:text:YES');
    expect(psql("select clean_title || '|' || coalesce(title_ur, 'null') from student_videos")).toBe('Muzakar Aur Mounas|null');
    expect(fails("update student_videos set title_ur = 'مذکر اور مؤنث', chapter_ur = 'اردو قواعد'")).toBeNull();
    expect(psql('select title_ur from student_videos')).toBe('مذکر اور مؤنث');
  });

  test('the rollback removes both columns and nothing else', () => {
    apply('web_quiz_student_videos_title_ur_rollback.sql');
    expect(psql("select count(*) from information_schema.columns where table_name = 'student_videos' and column_name in ('title_ur', 'chapter_ur')")).toBe('0');
    expect(psql('select clean_title from student_videos')).toBe('Muzakar Aur Mounas');
    apply('web_quiz_student_videos_title_ur_rollback.sql');
  });
});
