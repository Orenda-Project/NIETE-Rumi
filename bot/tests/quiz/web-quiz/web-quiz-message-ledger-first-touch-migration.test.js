'use strict';
/**
 * web_quiz_message_ledger_first_touch.sql on a real, throwaway Postgres (initdb in a temp folder, a unix socket, no
 * TCP), applied after the ledger's three migrations: the trigger CHECK re-made with the seven names plus door_reply,
 * maker_reply and family_reply (additive: every existing row and name still passes; an unknown name is still refused),
 * the three new names count through message_ledger_add one row per day, it applies twice, and the rollback restores
 * the seven (refusing it only if a row of the three exists, so nothing is ever silently dropped).
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
if (!PG) console.warn('web-quiz-message-ledger-first-touch-migration: no Postgres server binaries found (set PG_BIN) — skipped');

let dir;
let sock;
const PORT = String(57900 + (process.pid % 900));
const psql = (sql, { file = null, user = 'postgres' } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', user, '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql, opts) => { try { psql(sql, opts); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f) => psql(null, { file: path.join(MIG, f) });
const ADD = (day, trigger, recipient, n) => `select public.message_ledger_add(p_day => '${day}', p_trigger => '${trigger}', p_class_id => null, `
  + `p_initiated => 'user', p_recipient => '${recipient}', p_n => ${n}, p_usd_each => 0.015)`;
const insert = (trigger) => `insert into message_ledger (day, trigger, initiated, recipient) values ('2026-11-09', '${trigger}', 'user', 'family')`;
const SEVEN = ['home_reply', 'bind_reply', 'guest_reply', 'class_link', 'class_round', 'teacher_queue', 'teacher_refusal'];
const THREE = [['door_reply', 'family'], ['maker_reply', 'teacher'], ['family_reply', 'family']];

d('the send ledger first-touch trigger names on a real Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqft-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqfs-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create role anon login; create role authenticated login; create role service_role login;');
    apply('web_quiz_message_ledger.sql');
    apply('web_quiz_message_ledger_minutes.sql');
    apply('web_quiz_message_ledger_capped.sql');
    psql(ADD('2026-11-01', 'home_reply', 'family', 2));   // a row written before the names existed
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('before it: the three names are refused by the CHECK (the red this migration answers)', () => {
    for (const [t] of THREE) expect(fails(insert(t))).toMatch(/message_ledger_trigger_check/);
  });

  test('applies twice cleanly; the old row and every one of the seven still pass; an unknown name is still refused', () => {
    apply('web_quiz_message_ledger_first_touch.sql');
    apply('web_quiz_message_ledger_first_touch.sql');
    expect(psql("select count || ' ' || usd from message_ledger where day = '2026-11-01' and trigger = 'home_reply'")).toBe('2 0.0300');
    for (const t of SEVEN) expect(fails(`${insert(t)} on conflict do nothing`)).toBeNull();
    expect(fails(insert('not_a_trigger'))).toMatch(/message_ledger_trigger_check/);
  });

  test('door_reply, maker_reply and family_reply count through message_ledger_add: one row per day per trigger', () => {
    for (const [t, r] of THREE) {
      psql(ADD('2026-11-02', t, r, 1));
      psql(ADD('2026-11-02', t, r, 1));
      psql(ADD('2026-11-03', t, r, 1));
      expect(psql(`select string_agg(day::text || '=' || count::text, ',' order by day) from message_ledger where trigger = '${t}'`)).toBe('2026-11-02=2,2026-11-03=1');
    }
  });

  test('the rollback refuses while a row of the three exists; with none, it restores the seven', () => {
    expect(fails(null, { file: path.join(MIG, 'web_quiz_message_ledger_first_touch_rollback.sql') })).toMatch(/message_ledger_trigger_check|check constraint/i);
    psql("delete from message_ledger where trigger in ('door_reply','maker_reply','family_reply')");
    apply('web_quiz_message_ledger_first_touch_rollback.sql');
    apply('web_quiz_message_ledger_first_touch_rollback.sql');
    expect(fails(insert('door_reply'))).toMatch(/message_ledger_trigger_check/);
    expect(fails(`${insert('guest_reply')} on conflict do nothing`)).toBeNull();
    apply('web_quiz_message_ledger_first_touch.sql');
    expect(fails(`${insert('family_reply')} on conflict do nothing`)).toBeNull();
  });
});
