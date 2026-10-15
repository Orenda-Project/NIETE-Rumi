'use strict';
/**
 * web_quiz_message_ledger.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no TCP).
 * The table and message_ledger_add(): one row per (PKT day, trigger, class, initiator, recipient), the count and
 * the US$ adding up per call at the price each call names; a bot-initiated send to a family refused by the CHECK;
 * EXECUTE for service_role only; applies twice; the rollback removes it all.
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
if (!PG) console.warn('web-quiz-message-ledger-migration: no Postgres server binaries found (set PG_BIN) — skipped');

let dir;
let sock;
const PORT = String(55000 + (process.pid % 900));
const psql = (sql, { file = null, user = 'postgres' } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', user, '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql, opts) => { try { psql(sql, opts); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f) => psql(null, { file: path.join(MIG, f) });
const CLASS = '55555555-5555-4555-8555-000000000001';
const add = (args) => psql(`select public.message_ledger_add(${args})`);

d('the send ledger migration on a real Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqml-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqs-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    // Supabase's roles, as the grants name them.
    psql('create role anon login; create role authenticated login; create role service_role login;');
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('applies twice cleanly; the table, its unique key and the function exist', () => {
    apply('web_quiz_message_ledger.sql');
    apply('web_quiz_message_ledger.sql');
    expect(psql("select to_regclass('public.message_ledger') is not null")).toBe('t');
    expect(psql("select count(*) from pg_indexes where indexname = 'message_ledger_key'")).toBe('1');
    expect(psql("select count(*) from pg_proc where proname = 'message_ledger_add'")).toBe('1');
  });

  test('two calls on one key make one row with count 2 (no class: the coalesced key still collides)', () => {
    expect(add("'2026-11-04', 'home_reply', null, 'user', 'family', 1")).toBe('1');
    expect(add("'2026-11-04', 'home_reply', null, 'user', 'family', 1")).toBe('2');
    expect(psql("select count(*) || ' ' || sum(count) || ' ' || sum(usd) from message_ledger where trigger = 'home_reply'")).toBe('1 2 0.0300');
  });

  test('the price is per call: two at 0.015 then one at 0.012 is count 3, usd 0.042', () => {
    add(`'2026-11-04', 'teacher_queue', '${CLASS}', 'bot', 'teacher', 1, 0.015`);
    add(`'2026-11-04', 'teacher_queue', '${CLASS}', 'bot', 'teacher', 1, 0.015`);
    expect(add(`'2026-11-04', 'teacher_queue', '${CLASS}', 'bot', 'teacher', 1, 0.012`)).toBe('3');
    expect(psql(`select count || ' ' || usd from message_ledger where trigger = 'teacher_queue' and class_id = '${CLASS}'`)).toBe('3 0.0420');
  });

  test('p_n > 1 adds n and price × n; another day, class or recipient is its own row', () => {
    expect(add("'2026-11-04', 'guest_reply', null, 'user', 'family', 3")).toBe('3');
    add("'2026-11-05', 'guest_reply', null, 'user', 'family', 1");
    add(`'2026-11-04', 'guest_reply', '${CLASS}', 'user', 'family', 1`);
    expect(psql("select string_agg(count::text || '@' || usd::text, ',' order by day, class_id nulls first) from message_ledger where trigger = 'guest_reply'"))
      .toBe('3@0.0450,1@0.0150,1@0.0150');
  });

  test('a bot-initiated send to a family is refused by the CHECK, through the function and directly', () => {
    expect(fails("select public.message_ledger_add('2026-11-04', 'home_reply', null, 'bot', 'family', 1)")).toMatch(/message_ledger_no_bot_to_family/);
    expect(fails("insert into message_ledger (day, trigger, initiated, recipient) values ('2026-11-04', 'home_reply', 'bot', 'family')")).toMatch(/message_ledger_no_bot_to_family/);
    expect(fails("select public.message_ledger_add('2026-11-04', 'promo', null, 'user', 'family', 1)")).toMatch(/check constraint/);
  });

  test('EXECUTE: service_role only (anon and authenticated refused)', () => {
    expect(fails("select public.message_ledger_add('2026-11-06', 'home_reply', null, 'user', 'family', 1)", { user: 'service_role' })).toBeNull();
    expect(fails("select public.message_ledger_add('2026-11-06', 'home_reply', null, 'user', 'family', 1)", { user: 'anon' })).toMatch(/permission denied/);
    expect(fails("select public.message_ledger_add('2026-11-06', 'home_reply', null, 'user', 'family', 1)", { user: 'authenticated' })).toMatch(/permission denied/);
  });

  test('the rollback removes the function and the table; it re-applies cleanly after', () => {
    apply('web_quiz_message_ledger_rollback.sql');
    expect(psql("select to_regclass('public.message_ledger') is null")).toBe('t');
    expect(psql("select count(*) from pg_proc where proname = 'message_ledger_add'")).toBe('0');
    apply('web_quiz_message_ledger.sql');
    expect(psql("select to_regclass('public.message_ledger') is not null")).toBe('t');
  });
});
