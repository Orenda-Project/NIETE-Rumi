'use strict';
/**
 * V1.10.4 — the in-app lesson-plan survey and the replica check. SQL-text contract test (no database).
 * (a) lp_feedback.trigger_mode also allows 'in_app' (an answer given in the teacher app), keeping both old values;
 * (b) public.db_is_replica() = pg_is_in_recovery(), SECURITY INVOKER, executable by service_role only, so a
 *     scheduled job can refuse to count on anything but a read replica.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DIR = path.join(ROOT, 'infrastructure/supabase/migrations');
const flat = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const read = (f) => flat(fs.readFileSync(path.join(DIR, f), 'utf8'));
const UP = read('V1.10.4__lp_feedback_in_app_and_replica_check.sql');
const DOWN = read('ROLLBACK_V1.10.4__lp_feedback_in_app_and_replica_check.sql');
const MIRROR = flat(fs.readFileSync(path.join(ROOT, 'infrastructure/supabase/00_complete-schema.sql'), 'utf8'));
const BASELINE = flat(fs.readFileSync(path.join(ROOT, 'supabase/baseline/schema.sql'), 'utf8'));
const OBJECTS = fs.readFileSync(path.join(ROOT, 'supabase/baseline/schema.objects.txt'), 'utf8').split('\n');

const LIST = "check (trigger_mode in ('after_voice_note', 'after_pdf_only', 'in_app'))";

test('the trigger_mode list is re-made under its own name with in_app and both old values', () => {
  expect(UP).toContain('alter table lp_feedback drop constraint if exists lp_feedback_trigger_mode_check');
  expect(UP).toContain(`alter table lp_feedback add constraint lp_feedback_trigger_mode_check ${LIST}`);
});

test('db_is_replica is a security invoker sql function returning pg_is_in_recovery()', () => {
  expect(UP).toMatch(/create or replace function public\.db_is_replica\(\) returns boolean language sql stable security invoker/);
  expect(UP).toMatch(/select pg_is_in_recovery\(\)/);
});

test('only service_role may execute it', () => {
  expect(UP).toContain('revoke all on function public.db_is_replica() from public, anon, authenticated');
  expect(UP).toContain('grant execute on function public.db_is_replica() to service_role');
});

test('no rows are touched, one transaction from the runner, PostgREST reloads', () => {
  expect(UP).not.toMatch(/\b(update|delete from|insert into|create table)\b/);
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops the function and puts the old two-value list back', () => {
  expect(DOWN).toContain('drop function if exists public.db_is_replica()');
  expect(DOWN).toContain("check (trigger_mode in ('after_voice_note', 'after_pdf_only'))");
  expect(DOWN).not.toMatch(/drop table/);
});

test('the fresh-install schema declares both', () => {
  expect(MIRROR).toContain("trigger_mode text check (trigger_mode in ('after_voice_note', 'after_pdf_only', 'in_app'))");
  expect(MIRROR).toMatch(/create or replace function public\.db_is_replica\(\) returns boolean/);
  expect(MIRROR).toContain('grant execute on function public.db_is_replica() to service_role');
});

test('the mock-lane baseline carries both, so an in-app answer saves there too', () => {
  expect(BASELINE).toContain("array['after_voice_note'::text, 'after_pdf_only'::text, 'in_app'::text]");
  expect(BASELINE).toMatch(/create function public\.db_is_replica\(\) returns boolean/);
  expect(OBJECTS).toContain('fn:db_is_replica()');
});
