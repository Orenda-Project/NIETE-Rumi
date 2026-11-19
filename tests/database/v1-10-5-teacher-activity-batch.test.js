'use strict';
/**
 * V1.10.5 — the twice-a-day teacher activity count's two read functions. SQL-text contract test (no database).
 *   teacher_activity_teachers()            the active teachers the run counts, with where each is placed
 *   teacher_activity_batch(p_user_ids)     one row per teacher: tiles (30 days vs the 30 before), journey steps,
 *                                          recent reports' indicator scores and the latest report's tip source
 * Both read only, run with the caller's rights, are bounded by a 20 s statement timeout and are callable by
 * service_role only (the job runs them on the read replica).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DIR = path.join(ROOT, 'infrastructure/supabase/migrations');
const flat = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const read = (f) => flat(fs.readFileSync(path.join(DIR, f), 'utf8'));
const UP = read('V1.10.5__teacher_activity_batch.sql');
const DOWN = read('ROLLBACK_V1.10.5__teacher_activity_batch.sql');
const MIRROR = flat(fs.readFileSync(path.join(ROOT, 'infrastructure/supabase/00_complete-schema.sql'), 'utf8'));
const BASELINE = flat(fs.readFileSync(path.join(ROOT, 'supabase/baseline/schema.sql'), 'utf8'));
const OBJECTS = fs.readFileSync(path.join(ROOT, 'supabase/baseline/schema.objects.txt'), 'utf8').split('\n');

const FNS = ['teacher_activity_teachers()', 'teacher_activity_batch(p_user_ids uuid[])'];

test('both functions are stable, security invoker and capped at 20 s', () => {
  expect(UP).toMatch(/create or replace function public\.teacher_activity_teachers\(\) returns jsonb language sql stable security invoker set statement_timeout = '20s'/);
  expect(UP).toMatch(/create or replace function public\.teacher_activity_batch\(p_user_ids uuid\[\]\) returns table \(user_id uuid, tiles jsonb, journey jsonb, reports jsonb, latest jsonb\) language sql stable security invoker set statement_timeout = '20s'/);
});

test('only service_role may execute them', () => {
  for (const f of ['public.teacher_activity_teachers()', 'public.teacher_activity_batch(uuid[])']) {
    expect(UP).toContain(`revoke all on function ${f} from public, anon, authenticated`);
    expect(UP).toContain(`grant execute on function ${f} to service_role`);
  }
});

test('the counts follow the existing rules', () => {
  // plans: the lp-history union of the three use ledgers, distinct kind:ref
  expect(UP).toContain('from niete_lp_opens');
  expect(UP).toContain("from niete_lp_downloads d where d.user_id = t.uid and d.status = 'sent'");
  expect(UP).toContain("from niete_lp612_deliveries g where g.user_id = t.uid and g.surface <> 'portal'");
  expect(UP).toContain("count(distinct kind || ':' || ref)");
  // taught, coached (countsFor's rule, by completed_at), quizzes, papers
  expect(UP).toContain("used_in_class = 'taught'");
  expect(UP).toContain("c.status = 'completed' and c.observation_type is null");
  expect(UP).toContain("q.status in ('sent', 'report_sent')");
  expect(UP).toContain("p.status = 'ready' and p.edited_from is null");
  expect(UP).toContain('from assessment_requests r join assessment_papers p on p.request_id = r.id');
  // Pakistan days
  expect(UP).toContain("at time zone 'asia/karachi'");
});

test('a non-array analysis_data part can never raise (guarded before it is expanded)', () => {
  expect(UP).toContain("jsonb_typeof(c.analysis_data -> 'domains') = 'object'");
  expect(UP).toContain("jsonb_typeof(d.value -> 'indicators') = 'array'");
});

test('the journey is bounded: 60 days, at most 200 steps, newest first', () => {
  expect(UP).toMatch(/order by s\.at desc limit 200/);
});

test('reads only: no write, no new table, no BEGIN/COMMIT, PostgREST reloads', () => {
  expect(UP).not.toMatch(/\b(update [a-z_]+ set|delete from|insert into|create table|alter table)\b/);
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops both', () => {
  expect(DOWN).toContain('drop function if exists public.teacher_activity_batch(uuid[])');
  expect(DOWN).toContain('drop function if exists public.teacher_activity_teachers()');
});

test('the fresh-install schema and the mock-lane baseline declare both', () => {
  for (const f of FNS) {
    const name = f.split('(')[0];
    expect(MIRROR).toContain(`create or replace function public.${name}(`);
    expect(BASELINE).toContain(`create function public.${name}(`);
    expect(OBJECTS).toContain(`fn:${f}`);
  }
});
