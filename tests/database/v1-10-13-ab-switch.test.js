'use strict';
/**
 * V1.10.13 — the A/B switch (bd-9nb6s0.6). SQL-text contract test (no database; the behaviour is proved on a throwaway
 * local Postgres by the workspace's ab-testing/scripts/test_switch_pg.py).
 * When the ledger says a test is concluded, ab_ledger_switch() hands the winner to everyone through the test's own
 * switch_key in app_settings. Fail closed: unless app_settings ab_switch_auto is JSON true it only records a pending
 * flip with the exact SQL that does it, for a person to run.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const flat = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const read = (f) => flat(fs.readFileSync(path.join(DIR, f), 'utf8'));
const UP = read('V1.10.13__ab_switch.sql');
const DOWN = read('ROLLBACK_V1.10.13__ab_switch.sql');
const COLUMNS = ['switch_state', 'switch_sql', 'switched_at'];

function body(name) {
  const at = UP.indexOf(`create or replace function public.${name}(`);
  if (at < 0) return '';
  const open = UP.indexOf('$$', at);
  return UP.slice(at, UP.indexOf('$$', open + 2) + 2);
}

test('adds three switch columns to ab_card_lock and makes no new table', () => {
  for (const c of COLUMNS) expect(UP).toMatch(new RegExp(`add column if not exists ${c} `));
  expect(UP).toMatch(/switch_state text check \(switch_state is null or switch_state in \('pending', 'flipped'\)\)/);
  expect(UP).not.toMatch(/create table/);
  for (const m of UP.matchAll(/alter table (?:public\.)?(\w+)/g)) expect(m[1]).toBe('ab_card_lock');
});

test('the switch is a 15 s write that touches only ab_card_lock and app_settings', () => {
  const b = body('ab_ledger_switch');
  expect(b).toMatch(/returns jsonb language plpgsql volatile security invoker set statement_timeout = '15s'/);
  for (const m of b.matchAll(/(?:insert into|(?<!do )update|delete from) (?:public\.)?(\w+)/g)) {
    expect(['ab_card_lock', 'app_settings']).toContain(m[1]);
  }
  expect(b).not.toMatch(/delete from/);
});

test('only concluded tests with a switch key and a winner, never one already flipped', () => {
  const b = body('ab_ledger_switch');
  expect(b).toContain("c.status = 'concluded'");
  expect(b).toContain('c.switch_key is not null');
  expect(b).toContain('c.winner is not null');
  expect(b).toContain("c.switch_state is distinct from 'flipped'");
});

test('fail closed: flips only when ab_switch_auto is JSON true, otherwise records pending with the SQL', () => {
  const b = body('ab_ledger_switch');
  expect(b).toContain("s.key = 'ab_switch_auto'");
  expect(b).toContain("'true'::jsonb");
  expect(b).toContain('coalesce(v_auto, false)');
  expect(b).toContain("switch_state = 'pending'");
  expect(b).toContain("switch_state = 'flipped'");
  expect(b).toContain('switch_sql = v_sql');
  expect(b).toMatch(/format\(/);
});

test('the app_settings value names the winner and the test', () => {
  expect(body('ab_ledger_switch')).toMatch(/jsonb_build_object\('winner', r\.winner, 'test_id', r\.test_id\)/);
});

test('only service_role may call it', () => {
  expect(UP).toMatch(/revoke all on function public\.ab_ledger_switch\(\) from public, anon, authenticated/);
  expect(UP).toMatch(/grant execute on function public\.ab_ledger_switch\(\) to service_role/);
});

test('one transaction from the runner, PostgREST reloads, no BEGIN/COMMIT', () => {
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops the function, then the three columns, and nothing else', () => {
  expect(DOWN).toContain('drop function if exists public.ab_ledger_switch()');
  for (const c of COLUMNS) expect(DOWN).toMatch(new RegExp(`drop column if exists ${c}\\b`));
  expect(DOWN).not.toMatch(/drop table|delete from|app_settings/);
  expect(DOWN.indexOf('drop function')).toBeLessThan(DOWN.indexOf('drop column'));
});
