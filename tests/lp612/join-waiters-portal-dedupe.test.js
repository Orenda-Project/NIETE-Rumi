'use strict';
/**
 * bd-2ibyoi. `lp612_join_waiters` de-duplicated on PHONE with IS NOT DISTINCT FROM. A portal waiter
 * has phone NULL, and NULL IS NOT DISTINCT FROM NULL is true — so the SECOND portal teacher on the
 * same in-flight G6-12 render was answered 'duplicate', the portal told her "joined", and she was
 * never appended: no claim row, her poll says "No such lesson request", the lesson never comes.
 *
 * V1.10.0 keeps the phone rule for WhatsApp waiters and de-duplicates a phone-less waiter on
 * (user_id, surface). Driven on a real, throwaway Postgres (initdb in a temp folder, unix socket),
 * applying the real migration files. Needs the Postgres server binaries (PG_BIN or pg_config
 * --bindir); without them the Postgres part is skipped and says so.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MIG = path.join(__dirname, '..', '..', 'infrastructure', 'supabase', 'migrations');
const SCHEMA = path.join(__dirname, '..', '..', 'infrastructure', 'supabase', '00_complete-schema.sql');
const FIX = 'V1.10.0__lp612_join_waiters_portal_dedupe.sql';
const ROLLBACK = 'ROLLBACK_V1.10.0__lp612_join_waiters_portal_dedupe.sql';

const binDir = (() => {
  const cands = [process.env.PG_BIN];
  try { cands.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* none */ }
  cands.push('/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/local/bin');
  return cands.find((c) => c && ['postgres', 'initdb', 'pg_ctl', 'psql'].every((b) => fs.existsSync(path.join(c, b)))) || null;
})();
const bin = (b) => path.join(binDir, b);
const d = binDir ? describe : describe.skip;
if (!binDir) console.warn('join-waiters-portal-dedupe: no Postgres server binaries found (set PG_BIN) — skipped');

// The schema file carries the function too (a fresh bootstrap must get the fixed body).
const fnBody = (sql) => {
  const t = sql.indexOf('CREATE OR REPLACE FUNCTION lp612_join_waiters(');
  const e = t >= 0 ? sql.indexOf('$$;', t) : -1;
  return t >= 0 && e > t ? sql.slice(t, e + 3) : null;
};
test('the schema file carries the same lp612_join_waiters body as the migration', () => {
  const mig = fnBody(fs.readFileSync(path.join(MIG, FIX), 'utf8'));
  expect(mig).toBeTruthy();
  expect(fnBody(fs.readFileSync(SCHEMA, 'utf8'))).toBe(mig);
});

let dir;
let sock;
const PORT = String(58900 + (process.pid % 90));
const psql = (sql, { file = null } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const apply = (f) => psql(null, { file: path.join(MIG, f) });

const RID = '11111111-1111-1111-1111-111111111111';
const join = (entry) => psql(`select lp612_join_waiters('${RID}', '${JSON.stringify(entry)}'::jsonb)`);
const count = () => psql(`select jsonb_array_length(waiters) from niete_lp612_renders where id = '${RID}'`);
// Phone-shaped values are built at runtime, never written as literals.
const ph = (n) => ['92', '300', String(1000000 + n)].join('');

d('on Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpjw-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'lpjs-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    // Only the columns the function touches.
    psql(`create table niete_lp612_renders (id uuid primary key, status text not null default 'authoring',
          waiters jsonb not null default '[]'::jsonb, updated_at timestamptz)`);
    apply('V1.3.2__lp612_atomic_waiter_join.sql');
    apply(FIX);
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });
  beforeEach(() => {
    psql('delete from niete_lp612_renders');
    psql(`insert into niete_lp612_renders (id) values ('${RID}')`);
  });

  test('two different portal teachers (phone null) on one render are BOTH appended', () => {
    expect(join({ user_id: 'u-portal-1', phone: null, surface: 'portal' })).toBe('joined');
    expect(join({ user_id: 'u-portal-2', phone: null, surface: 'portal' })).toBe('joined');
    expect(count()).toBe('2');
  });

  test('the same portal teacher asking twice is still one entry', () => {
    expect(join({ user_id: 'u-portal-1', phone: null, surface: 'portal' })).toBe('joined');
    expect(join({ user_id: 'u-portal-1', phone: null, surface: 'portal' })).toBe('duplicate');
    expect(count()).toBe('1');
  });

  test('WhatsApp waiters still de-duplicate on phone (tapping twice is one delivery)', () => {
    expect(join({ user_id: 'u1', phone: ph(1), surface: 'whatsapp' })).toBe('joined');
    expect(join({ user_id: null, phone: ph(1), surface: 'whatsapp' })).toBe('duplicate');
    expect(join({ user_id: 'u2', phone: ph(2), surface: 'whatsapp' })).toBe('joined');
    expect(count()).toBe('2');
  });

  test('one teacher waiting on WhatsApp AND in the portal gets both (two surfaces, two deliveries)', () => {
    expect(join({ user_id: 'u1', phone: ph(1), surface: 'whatsapp' })).toBe('joined');
    expect(join({ user_id: 'u1', phone: null, surface: 'portal' })).toBe('joined');
    expect(count()).toBe('2');
  });

  test('a finished render still refuses the append', () => {
    psql(`update niete_lp612_renders set status = 'ready' where id = '${RID}'`);
    expect(join({ user_id: 'u-portal-1', phone: null, surface: 'portal' })).toBe('not_authoring');
  });

  test('the rollback restores the V1.3.2 body and applies twice cleanly', () => {
    apply(ROLLBACK);
    apply(ROLLBACK);
    expect(join({ user_id: 'u-portal-1', phone: null, surface: 'portal' })).toBe('joined');
    expect(join({ user_id: 'u-portal-2', phone: null, surface: 'portal' })).toBe('duplicate'); // the old bug, by design of the rollback
    apply(FIX);
  });
});
