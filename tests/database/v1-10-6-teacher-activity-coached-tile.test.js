'use strict';
/**
 * V1.10.6 — Home's "DC observations" tile counts what the list it opens shows (bd-96f69c.11). SQL-text contract test.
 * The tile opens "All DC observations" (dashboard/services/teacher-coaching.service.js HISTORY_SQL), which lists every
 * lesson she sent that was not stopped, by created_at. V1.10.5 counted completed lessons by completed_at, so a lesson
 * still being analysed, or one sent just before the window, made the two numbers disagree. Journey steps, reports and
 * the tip keep the completed rule. The schema mirror and the baseline carry the same function.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DIR = path.join(ROOT, 'infrastructure/supabase/migrations');
const flat = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const read = (f) => flat(fs.readFileSync(path.join(DIR, f), 'utf8'));
const UP = read('V1.10.6__teacher_activity_coached_tile.sql');
const DOWN = read('ROLLBACK_V1.10.6__teacher_activity_coached_tile.sql');
const MIRROR = flat(fs.readFileSync(path.join(ROOT, 'infrastructure/supabase/00_complete-schema.sql'), 'utf8'));
const BASELINE = flat(fs.readFileSync(path.join(ROOT, 'supabase/baseline/schema.sql'), 'utf8'));
const LIST = fs.readFileSync(path.join(ROOT, 'dashboard/services/teacher-coaching.service.js'), 'utf8');

const TILE = "'coached', jsonb_build_object('now', listed.now_n, 'prev', listed.prev_n)";
const LISTED = [
  'count(*) filter (where c.created_at >= w.now_from) as now_n',
  'count(*) filter (where c.created_at < w.now_from) as prev_n',
  'where c.user_id = t.uid and c.observation_type is null and c.created_at >= w.prev_from',
  "and (c.status not in ('failed', 'cancelled', 'abandoned') or (c.status = 'cancelled' and c.failed_step = 'not_a_class_no_answer'))",
  "and c.status not in ('initiated', 'pending')",
  ') listed on true',
];

test('the list uses the same stopped / not-started statuses the tile copies', () => {
  expect(LIST).toContain(`const STOPPED = "('failed', 'cancelled', 'abandoned')";`);
  expect(LIST).toContain(`const NOT_STARTED = "('initiated', 'pending')";`);
  expect(LIST).toContain("OR (status = 'cancelled' AND failed_step = 'not_a_class_no_answer'))");
  expect(LIST).toContain("pkInstantWindow('created_at'");
});

test.each([['migration', UP], ['schema mirror', MIRROR], ['baseline', BASELINE]])('%s: the tile counts the list rule', (_, sql) => {
  expect(sql).toContain(TILE);
  for (const part of LISTED) expect(sql).toContain(part);
  expect(sql).not.toContain("'coached', jsonb_build_object('now', coached.now_n, 'prev', coached.prev_n)");
});

test('journey steps keep the completed rule', () => {
  expect(UP).toContain("where c.user_id = t.uid and c.status = 'completed' and c.observation_type is null and c.completed_at >= w.prev_from");
});

test('same signature, stable, invoker, 20 s, service_role only; rollback restores V1.10.5', () => {
  expect(UP).toMatch(/create or replace function public\.teacher_activity_batch\(p_user_ids uuid\[\]\) returns table \(user_id uuid, tiles jsonb, journey jsonb, reports jsonb, latest jsonb\) language sql stable security invoker set statement_timeout = '20s'/);
  expect(UP).toContain('revoke all on function public.teacher_activity_batch(uuid[]) from public, anon, authenticated');
  expect(UP).toContain('grant execute on function public.teacher_activity_batch(uuid[]) to service_role');
  expect(DOWN).toContain("'coached', jsonb_build_object('now', coached.now_n, 'prev', coached.prev_n)");
  expect(DOWN).not.toContain(') listed on true');
  expect(DOWN).toContain('grant execute on function public.teacher_activity_batch(uuid[]) to service_role');
});
