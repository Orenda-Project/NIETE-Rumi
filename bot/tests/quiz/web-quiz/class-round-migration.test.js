'use strict';
/**
 * web_quiz_class_round.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no TCP), and the
 * same table and view in infrastructure/supabase/00_complete-schema.sql, byte for byte.
 * The draw row: seed, weights_version and plan_sha256 required (the hash is 64 lower-case hex, no default); a class
 * at most once a term and once an academic year; the close's counted_k / present_counted_k / position_aggregates.
 * The view class_round_lines_v: one row per draw in the shape the term's statement reads. Applies twice cleanly; the
 * rollback removes it all.
 *
 * Needs the Postgres server binaries (postgres, initdb, pg_ctl, psql: PG_BIN or pg_config --bindir); without them the
 * Postgres part is skipped and says so (the byte-for-byte check always runs).
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
if (!binDir) console.warn('class-round-migration: no Postgres server binaries found (set PG_BIN) — the Postgres part is skipped');

// ── the mirror: the migration's table, indexes and view appear in the schema file exactly ────────────────────────
const statements = (sql) => {
  const t = sql.indexOf('CREATE TABLE IF NOT EXISTS class_round_draws (');
  const end = sql.indexOf('LEFT JOIN public.classes c ON c.id = d.class_id;', t) + 'LEFT JOIN public.classes c ON c.id = d.class_id;'.length;
  return t >= 0 && end > t ? sql.slice(t, end) : null;
};
test('the schema file mirrors the migration\'s table, indexes, row level security and view byte for byte', () => {
  const mig = statements(fs.readFileSync(path.join(MIG, 'web_quiz_class_round.sql'), 'utf8'));
  expect(mig).toBeTruthy();
  expect(statements(fs.readFileSync(SCHEMA, 'utf8'))).toBe(mig);
  ['seed                bigint NOT NULL,', 'weights_version     text NOT NULL,', "plan_sha256         text NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),",
    'counted_k           integer CHECK (counted_k >= 0),', 'present_counted_k   integer CHECK (present_counted_k >= 0),', 'position_aggregates jsonb,',
    'week_forwarded_at   timestamptz,', 'ON public.class_round_draws (class_id, left(term_code, 7));', 'CREATE OR REPLACE VIEW public.class_round_lines_v WITH (security_invoker = true) AS',
  ].forEach((line) => expect(mig).toContain(line));
});

let dir;
let sock;
const PORT = String(56000 + (process.pid % 900));
const psql = (sql, { file = null } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql) => { try { psql(sql); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f) => psql(null, { file: path.join(MIG, f) });

const PLAN = 'c971d4d956f5b0f1e0cc297b04696b20e1985a0a4b7161ddbefac40e4079c2bb';
const SCHOOL = 'd0000000-0000-4000-8000-0000000000d1';
const CLS = (n) => `c0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
let seq = 0;
const row = (cols = {}) => {
  seq += 1;
  const all = { round: seq.toString(16).padStart(16, '0'), term_code: '2026-27b', class_id: CLS(seq), stratum: 'Sector A|G23', N_h: 10, n_h: 3, p_incl: 0.3,
    seed: 42, weights_version: 'cr-2026-27b.1', plan_sha256: PLAN, window_start: '2027-01-18T00:00:00+05', window_end: '2027-02-15T00:00:00+05',
    order_arm: 'round_first', week_start: '2027-03-08T00:00:00+05', week_end: '2027-03-15T00:00:00+05', roster_k: 30, ...cols };
  const q = (k) => (k === 'N_h' || k === 'n_h' ? `"${k}"` : k);
  const v = (x) => (x === null ? 'null' : (typeof x === 'object' ? `'${JSON.stringify(x)}'::jsonb` : `'${x}'`));
  return `insert into class_round_draws (${Object.keys(all).map(q).join(', ')}) values (${Object.values(all).map(v).join(', ')})`;
};

d('class_round_draws and class_round_lines_v on a real Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqcr-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqcs-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create table public.classes (id uuid primary key, school_id uuid)');
    psql(`insert into classes select ('c0000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid, '${SCHOOL}' from generate_series(1, 40) g`);
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('applies twice cleanly; the view exists with security_invoker', () => {
    apply('web_quiz_class_round.sql');
    apply('web_quiz_class_round.sql');
    expect(psql("select count(*) from pg_class where relname in ('class_round_draws', 'class_round_lines_v')")).toBe('2');
    expect(psql("select reloptions::text from pg_class where relname = 'class_round_lines_v'")).toBe('{security_invoker=true}');
    expect(psql("select count(*) from pg_indexes where indexname = 'class_round_draws_once_a_year'")).toBe('1');
  });

  test('the draw names its plan: seed, weights_version and plan_sha256 are required; the hash is 64 lower-case hex', () => {
    expect(fails(row())).toBeNull();
    expect(fails(row({ seed: null }))).toMatch(/null value in column "seed"/);
    expect(fails(row({ weights_version: null }))).toMatch(/null value in column "weights_version"/);
    expect(fails(row({ plan_sha256: null }))).toMatch(/null value in column "plan_sha256"/);
    expect(fails(row({ plan_sha256: PLAN.toUpperCase() }))).toMatch(/check constraint/);
    expect(fails(row({ plan_sha256: PLAN.slice(1) }))).toMatch(/check constraint/);
    // no default: a row that leaves weights_version out is refused
    expect(fails(`insert into class_round_draws (round, term_code, class_id, stratum, "N_h", "n_h", p_incl, seed, plan_sha256, window_start, window_end, order_arm, roster_k)
      values ('ffffffffffffff01', '2026-27b', '${CLS(39)}', 'S|G23', 1, 1, 1, 1, '${PLAN}', now(), now() + interval '1 day', 'round_first', 5)`)).toMatch(/null value in column "weights_version"/);
  });

  test('a class at most once an academic year: 2027-28a then 2027-28b is refused; 2028-29a is not', () => {
    expect(fails(row({ class_id: CLS(30), term_code: '2027-28a' }))).toBeNull();
    expect(fails(row({ class_id: CLS(30), term_code: '2027-28b' }))).toMatch(/class_round_draws_once_a_year/);
    expect(fails(row({ class_id: CLS(30), term_code: '2028-29a' }))).toBeNull();
  });

  test('the view: one row per draw in the statement\'s shape; counts from the close, or from the round as it stands', () => {
    psql('delete from class_round_draws');
    const agg = [{ band: 'G23', pos_bin: '1-5', n: 4, zero_k: 1, rapid_k: 0 }, { band: 'G23', pos_bin: '6-10', n: 5, zero_k: 0, rapid_k: 1 }];
    const order = [{ id: 'a', s: 'done' }, { id: 'b', s: 'absent' }, { id: 'c', s: 'declined' }, { id: 'd', s: 'done' }, { id: 'e', s: 'todo' }];
    psql(row({ round: '00000000000000a1', class_id: CLS(1), accepted_at: '2027-01-20T09:00:00+05', started_at: '2027-01-20T09:00:00+05', finished_at: '2027-01-25T10:00:00+05',
      children_present: 28, children_played: 26, counted_k: 10, present_counted_k: 9, position_aggregates: agg,
      state: { order, k: { present: 28, absent: 2, declined: 2, done: 26 } }, week_forwarded_at: '2027-03-08T08:00:00+05' }));
    psql(row({ round: '00000000000000a2', class_id: CLS(2), stratum: 'Sector B|G45', accepted_at: '2027-01-21T09:00:00+05', started_at: '2027-01-21T09:00:00+05', state: { order } }));
    psql(row({ round: '00000000000000a3', class_id: CLS(3), declined_at: '2027-01-02T09:00:00+05' }));
    psql(row({ round: '00000000000000a4', class_id: CLS(4) }));
    const cols = psql("select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'class_round_lines_v'::regclass and attnum > 0");
    expect(cols.split(',')).toEqual(['round', 'term_code', 'class_id', 'school_id', 'band', 'stratum', 'p_incl', 'N_h', 'n_h', 'weights_version', 'plan_sha256',
      'order_arm', 'window_start', 'window_end', 'week_start', 'week_end', 'state', 'closed', 'present_k', 'absent_k', 'declined_k', 'done_k', 'counted_k',
      'present_counted_k', 'position_aggregates', 'week_forwarded', 'roster_k']);
    const rows = JSON.parse(psql('select json_agg(v order by round) from class_round_lines_v v'));
    expect(rows.map((r) => [r.round, r.band, r.state, r.closed, r.present_k, r.absent_k, r.declined_k, r.done_k, r.counted_k, r.present_counted_k, r.week_forwarded])).toEqual([
      ['00000000000000a1', 'G23', 'accepted', true, 28, 2, 2, 26, 10, 9, true],
      ['00000000000000a2', 'G45', 'accepted', false, 4, 1, 1, 2, null, null, false],
      ['00000000000000a3', 'G23', 'declined', false, null, null, null, null, null, null, false],
      ['00000000000000a4', 'G23', 'not_yet', false, null, null, null, null, null, null, false],
    ]);
    expect(rows[0]).toMatchObject({ school_id: SCHOOL, class_id: CLS(1), term_code: '2026-27b', N_h: 10, n_h: 3, p_incl: 0.3, weights_version: 'cr-2026-27b.1',
      plan_sha256: PLAN, order_arm: 'round_first', position_aggregates: agg, roster_k: 30 });
    // the view carries no state jsonb, no child id, no name
    expect(JSON.stringify(rows)).not.toMatch(/"order"|"id":"a"/);
  });

  test('the rollback removes the view and the table', () => {
    apply('web_quiz_class_round_rollback.sql');
    expect(psql("select count(*) from pg_class where relname in ('class_round_draws', 'class_round_lines_v')")).toBe('0');
  });
});
