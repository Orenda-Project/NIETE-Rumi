'use strict';
/**
 * web_quiz_message_ledger_one_door.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no TCP),
 * after the ledger, minutes and capped migrations: the trigger CHECK gains `one_door_reply` and `maker_reply`, the seven
 * triggers it allowed are still allowed, anything else is still refused, it applies twice, and the rollback narrows it
 * back. Red on the base: `one_door_reply` is refused by the CHECK.
 *
 * Needs the Postgres server binaries (PG_BIN or pg_config --bindir); without them the suite is skipped and says so.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MIG = path.join(__dirname, '..', '..', 'database', 'migrations');
const binDir = (() => {
  const cands = [process.env.PG_BIN];
  try { cands.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* none */ }
  cands.push('/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/local/bin');
  return cands.find((c) => c && ['postgres', 'initdb', 'pg_ctl', 'psql'].every((b) => fs.existsSync(path.join(c, b)))) || null;
})();
const bin = (b) => path.join(binDir, b);
const PG = !!binDir;
const d = PG ? describe : describe.skip;
if (!PG) console.warn('web-quiz-message-ledger-one-door-migration: no Postgres server binaries found (set PG_BIN) — skipped');

let dir;
let sock;
const PORT = String(58000 + (process.pid % 900));
const psql = (sql, { file = null, user = 'postgres' } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', user, '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql, opts) => { try { psql(sql, opts); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f) => psql(null, { file: path.join(MIG, f) });
const ADD = (trigger) => `select public.message_ledger_add('2026-11-04', '${trigger}', null, 'user', 'family', 1)`;
const OLD = ['home_reply', 'bind_reply', 'guest_reply', 'class_link', 'class_round', 'teacher_queue', 'teacher_refusal'];

d('the send ledger one-door migration on a real Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqod-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqos-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create role anon login; create role authenticated login; create role service_role login;');
    apply('web_quiz_message_ledger.sql');
    apply('web_quiz_message_ledger_minutes.sql');
    apply('web_quiz_message_ledger_capped.sql');
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('before it: the one /quiz reply is refused by the trigger CHECK (the base)', () => {
    expect(fails(ADD('one_door_reply'))).toMatch(/message_ledger_trigger_check/);
  });

  test('applies twice; one_door_reply and maker_reply are counted; the seven old triggers still are; anything else is refused', () => {
    apply('web_quiz_message_ledger_one_door.sql');
    apply('web_quiz_message_ledger_one_door.sql');
    for (const t of [...OLD, 'one_door_reply', 'maker_reply']) expect(fails(ADD(t))).toBeNull();
    expect(psql("select count from message_ledger where trigger = 'one_door_reply'")).toBe('1');
    expect(fails(ADD('promo'))).toMatch(/message_ledger_trigger_check/);
    expect(fails("select public.message_ledger_add('2026-11-04', 'one_door_reply', null, 'bot', 'family', 1)")).toMatch(/message_ledger_no_bot_to_family/);
  });

  test('the rollback removes the new rows and narrows the CHECK; old rows kept; it re-applies after', () => {
    apply('web_quiz_message_ledger_one_door_rollback.sql');
    expect(psql("select count(*) from message_ledger where trigger in ('one_door_reply','maker_reply')")).toBe('0');
    expect(psql("select count(*) from message_ledger where trigger = 'home_reply'")).toBe('1');
    expect(fails(ADD('one_door_reply'))).toMatch(/message_ledger_trigger_check/);
    apply('web_quiz_message_ledger_one_door.sql');
    expect(fails(ADD('maker_reply'))).toBeNull();
  });
});
