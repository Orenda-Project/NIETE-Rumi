'use strict';
/**
 * V1.10.12 — the A/B ledger (bd-9nb6s0.2). SQL-text contract test (no database; the behaviour is proved on a
 * throwaway local Postgres by the workspace's ab-testing/scripts/test_ledger_pg.py).
 * Schema-first (Rule 15): it EXTENDS ab_card_lock (V1.10.7) with the ledger columns, no new table, and adds four
 * functions: ab_ledger_upsert (freeze writes a planned row), ab_ledger_call (decide writes the call),
 * ab_ledger_advance (the tracker cron: planned -> running -> concluded) and ab_ledger_past_tests (find.py reads).
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const flat = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const read = (f) => flat(fs.readFileSync(path.join(DIR, f), 'utf8'));
const UP = read('V1.10.12__ab_ledger.sql');
const DOWN = read('ROLLBACK_V1.10.12__ab_ledger.sql');

const COLUMNS = ['description', 'status', 'winner', 'default_arm', 'switch_key', 'owner', 'feature', 'arm_a',
  'arm_b', 'launch_date', 'planned_n', 'current_n', 'call', 'called_at'];
const WRITES = ['ab_ledger_upsert', 'ab_ledger_call', 'ab_ledger_advance'];
const READS = ['ab_ledger_past_tests'];

function body(name) {
  const at = UP.indexOf(`create or replace function public.${name}(`);
  if (at < 0) return '';
  const open = UP.indexOf('$$', at);
  return UP.slice(at, UP.indexOf('$$', open + 2) + 2);
}

test('extends ab_card_lock with every ledger column and makes no new table', () => {
  for (const c of COLUMNS) expect(UP).toMatch(new RegExp(`add column if not exists ${c} `));
  expect(UP).not.toMatch(/create table/);
  for (const m of UP.matchAll(/alter table (?:public\.)?(\w+)/g)) expect(m[1]).toBe('ab_card_lock');
});

test('status is planned, running or concluded, planned by default', () => {
  expect(UP).toMatch(/status text not null default 'planned'/);
  expect(UP).toContain("check (status in ('planned', 'running', 'concluded'))");
});

test('arms, winner and default are arm labels; the switch is an ab_ app_settings key', () => {
  expect(UP).toMatch(/winner text check \(winner is null or winner ~ '\^\[a-z0-9_\]\{1,24\}\$'\)/);
  expect(UP).toMatch(/default_arm text check \(default_arm is null or default_arm ~ /);
  expect(UP).toMatch(/switch_key text check \(switch_key is null or switch_key ~ '\^ab_/);
  expect(UP).toMatch(/planned_n integer check \(planned_n is null or planned_n > 0\)/);
  expect(UP).toMatch(/current_n integer not null default 0 check \(current_n >= 0\)/);
});

test('writes are 15 s, security invoker, and touch only ab_ tables', () => {
  for (const f of WRITES) {
    const b = body(f);
    expect(b).toMatch(/language plpgsql volatile security invoker set statement_timeout = '15s'/);
    for (const m of b.matchAll(/(?:insert into|(?<!do )update|delete from) (?:public\.)?(\w+)/g)) expect(m[1]).toMatch(/^ab_/);
  }
});

test('the upsert writes a planned row and never rewinds a running or concluded test', () => {
  const b = body('ab_ledger_upsert');
  expect(b).toContain('on conflict (test_id) do update');
  expect(b).toContain("where c.status = 'planned'");
});

test('advance moves planned -> running on the first assignment and running -> concluded once a call is written', () => {
  const b = body('ab_ledger_advance');
  expect(b).toContain("set status = 'running'");
  expect(b).toContain("where c.status = 'planned' and c.current_n > 0");
  expect(b).toContain("set status = 'concluded'");
  expect(b).toContain("where c.status = 'running' and c.call is not null");
  expect(b).toContain('returns jsonb');
});

test('the call is written once: a second call for the same test is refused', () => {
  const b = body('ab_ledger_call');
  expect(b).toContain('c.call is null');
  expect(b).toMatch(/raise exception 'ab_ledger_call:/);
});

test('past tests is a STABLE 30 s read that only reads', () => {
  const b = body('ab_ledger_past_tests');
  expect(b).toMatch(/language sql stable security invoker set statement_timeout = '30s'/);
  expect(b).not.toMatch(/\b(insert into|update \w+ set|delete from|truncate)\b/);
});

test('only service_role may call any function', () => {
  for (const f of [...WRITES, ...READS]) {
    expect(UP).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`));
    expect(UP).toMatch(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`));
  }
});

test('one transaction from the runner, PostgREST reloads, no BEGIN/COMMIT', () => {
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops the four functions, then the columns, and nothing else', () => {
  for (const f of [...WRITES, ...READS]) expect(DOWN).toContain(`drop function if exists public.${f}(`);
  for (const c of COLUMNS) expect(DOWN).toMatch(new RegExp(`drop column if exists ${c}\\b`));
  expect(DOWN).not.toMatch(/drop table/);
  for (const m of DOWN.matchAll(/alter table (?:if exists )?(?:public\.)?(\w+)/g)) expect(m[1]).toBe('ab_card_lock');
  expect(DOWN.indexOf('drop function')).toBeLessThan(DOWN.indexOf('drop column'));
});
