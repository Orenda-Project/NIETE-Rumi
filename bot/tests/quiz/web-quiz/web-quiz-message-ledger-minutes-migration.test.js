'use strict';
/**
 * web_quiz_message_ledger_minutes.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no TCP),
 * applied after web_quiz_message_ledger.sql: the `minutes` column, and message_ledger_add with an eighth argument
 * p_minutes_each (default 0). A call with the old seven named arguments still works and adds 0 minutes; one with
 * p_minutes_each adds round(each × n, 2); minutes below 0 are refused; EXECUTE stays service_role only; applies twice;
 * the rollback restores the seven-argument function and drops the column.
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
if (!PG) console.warn('web-quiz-message-ledger-minutes-migration: no Postgres server binaries found (set PG_BIN) — skipped');

let dir;
let sock;
const PORT = String(56000 + (process.pid % 900));
const psql = (sql, { file = null, user = 'postgres' } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', user, '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql, opts) => { try { psql(sql, opts); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f) => psql(null, { file: path.join(MIG, f) });
const CLASS = '55555555-5555-4555-8555-000000000001';
// the call the bot makes today (PostgREST passes named arguments)
const OLD_CALL = (day, n) => `select public.message_ledger_add(p_day => '${day}', p_trigger => 'class_round', p_class_id => '${CLASS}', `
  + `p_initiated => 'bot', p_recipient => 'teacher', p_n => ${n}, p_usd_each => 0.015)`;
const NEW_CALL = (day, n, each) => `select public.message_ledger_add(p_day => '${day}', p_trigger => 'class_round', p_class_id => '${CLASS}', `
  + `p_initiated => 'bot', p_recipient => 'teacher', p_n => ${n}, p_usd_each => 0.015, p_minutes_each => ${each})`;
const row = (day) => psql(`select count || ' ' || usd || ' ' || minutes from message_ledger where day = '${day}' and class_id = '${CLASS}'`);
const sigs = () => psql("select string_agg(pg_get_function_identity_arguments(oid), ' | ') from pg_proc where proname = 'message_ledger_add'");

d('the send ledger minutes migration on a real Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqmm-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqms-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create role anon login; create role authenticated login; create role service_role login;');
    apply('web_quiz_message_ledger.sql');
    // a row written before the column existed
    psql(OLD_CALL('2026-11-01', 2));
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('applies twice cleanly; ONE function, the eight-argument one; the old row reads minutes 0', () => {
    apply('web_quiz_message_ledger_minutes.sql');
    apply('web_quiz_message_ledger_minutes.sql');
    expect(sigs()).toBe('p_day date, p_trigger text, p_class_id uuid, p_initiated text, p_recipient text, p_n integer, '
      + 'p_usd_each numeric, p_minutes_each numeric');
    expect(row('2026-11-01')).toBe('2 0.0300 0.00');
  });

  test('the old seven named arguments still work (no ambiguous overload) and add 0 minutes', () => {
    expect(psql(OLD_CALL('2026-11-01', 1))).toBe('3');
    expect(row('2026-11-01')).toBe('3 0.0450 0.00');
    expect(psql("select public.message_ledger_add('2026-11-01', 'home_reply', null, 'user', 'family', 1)")).toBe('1');
  });

  test('p_minutes_each adds round(each × n, 2), on insert and on conflict', () => {
    expect(psql(NEW_CALL('2026-11-02', 3, 1))).toBe('3');
    expect(row('2026-11-02')).toBe('3 0.0450 3.00');
    expect(psql(NEW_CALL('2026-11-02', 3, 0.333))).toBe('6');
    expect(row('2026-11-02')).toBe('6 0.0900 4.00');
  });

  test('minutes below 0 are refused, through the function and directly', () => {
    expect(fails(NEW_CALL('2026-11-03', 1, -1))).toMatch(/check constraint/);
    expect(fails(`update message_ledger set minutes = -1 where day = '2026-11-02'`)).toMatch(/check constraint/);
    expect(row('2026-11-02')).toBe('6 0.0900 4.00');
  });

  test('EXECUTE on the eight-argument function: service_role only', () => {
    expect(fails(NEW_CALL('2026-11-04', 1, 1), { user: 'service_role' })).toBeNull();
    expect(fails(NEW_CALL('2026-11-04', 1, 1), { user: 'anon' })).toMatch(/permission denied/);
    expect(fails(NEW_CALL('2026-11-04', 1, 1), { user: 'authenticated' })).toMatch(/permission denied/);
  });

  test('the rollback restores the seven-argument function and drops the column; counts kept; re-applies after', () => {
    apply('web_quiz_message_ledger_minutes_rollback.sql');
    apply('web_quiz_message_ledger_minutes_rollback.sql');
    expect(sigs()).toBe('p_day date, p_trigger text, p_class_id uuid, p_initiated text, p_recipient text, p_n integer, p_usd_each numeric');
    expect(psql("select count(*) from information_schema.columns where table_name = 'message_ledger' and column_name = 'minutes'")).toBe('0');
    expect(psql(OLD_CALL('2026-11-02', 1))).toBe('7');
    expect(fails(NEW_CALL('2026-11-02', 1, 1))).toMatch(/does not exist/);
    expect(fails("select public.message_ledger_add('2026-11-06', 'home_reply', null, 'user', 'family', 1)", { user: 'anon' })).toMatch(/permission denied/);
    apply('web_quiz_message_ledger_minutes.sql');
    expect(row('2026-11-02')).toBe('7 0.1050 0.00');
    expect(psql(NEW_CALL('2026-11-02', 2, 1))).toBe('9');
    expect(row('2026-11-02')).toBe('9 0.1350 2.00');
  });
});
