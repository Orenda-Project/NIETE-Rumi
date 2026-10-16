'use strict';
/**
 * web_quiz_message_ledger_capped.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no TCP),
 * applied after web_quiz_message_ledger.sql and web_quiz_message_ledger_minutes.sql: the `capped` column (default 0,
 * never below 0), the row written before it reads 0, message_ledger_add is untouched and never writes it, applies
 * twice, and the rollback drops the column keeping counts, US$ and minutes.
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
if (!PG) console.warn('web-quiz-message-ledger-capped-migration: no Postgres server binaries found (set PG_BIN) — skipped');

let dir;
let sock;
const PORT = String(57000 + (process.pid % 900));
const psql = (sql, { file = null, user = 'postgres' } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', user, '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql, opts) => { try { psql(sql, opts); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f) => psql(null, { file: path.join(MIG, f) });
const CLASS = '55555555-5555-4555-8555-000000000001';
const CALL = (day, n) => `select public.message_ledger_add(p_day => '${day}', p_trigger => 'home_reply', p_class_id => '${CLASS}', `
  + `p_initiated => 'user', p_recipient => 'family', p_n => ${n}, p_usd_each => 0.015)`;
const row = (day) => psql(`select count || ' ' || usd || ' ' || minutes || ' ' || capped from message_ledger where day = '${day}' and class_id = '${CLASS}'`);
const hasCol = () => psql("select count(*) from information_schema.columns where table_name = 'message_ledger' and column_name = 'capped'");

d('the send ledger capped migration on a real Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqcm-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqcs-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create role anon login; create role authenticated login; create role service_role login;');
    apply('web_quiz_message_ledger.sql');
    apply('web_quiz_message_ledger_minutes.sql');
    psql(CALL('2026-11-01', 2));   // a row written before the column existed
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('applies twice cleanly; the old row reads capped 0; counts, US$ and minutes untouched', () => {
    apply('web_quiz_message_ledger_capped.sql');
    apply('web_quiz_message_ledger_capped.sql');
    expect(hasCol()).toBe('1');
    expect(row('2026-11-01')).toBe('2 0.0300 0.00 0');
  });

  test('message_ledger_add is untouched and never writes capped; a direct add of a cap hit keeps count and usd', () => {
    psql(CALL('2026-11-01', 1));
    expect(row('2026-11-01')).toBe('3 0.0450 0.00 0');
    psql(`update message_ledger set capped = capped + 1 where day = '2026-11-01' and class_id = '${CLASS}'`);
    expect(row('2026-11-01')).toBe('3 0.0450 0.00 1');
  });

  test('capped below 0 is refused', () => {
    expect(fails(`update message_ledger set capped = -1 where day = '2026-11-01' and class_id = '${CLASS}'`)).toMatch(/check/i);
  });

  test('the rollback drops the column, keeps the row; the migration re-applies after', () => {
    apply('web_quiz_message_ledger_capped_rollback.sql');
    expect(hasCol()).toBe('0');
    expect(psql(`select count || ' ' || usd || ' ' || minutes from message_ledger where day = '2026-11-01' and class_id = '${CLASS}'`)).toBe('3 0.0450 0.00');
    apply('web_quiz_message_ledger_capped.sql');
    expect(row('2026-11-01')).toBe('3 0.0450 0.00 0');
  });
});
