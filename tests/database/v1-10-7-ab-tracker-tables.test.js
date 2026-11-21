'use strict';
/**
 * V1.10.7 — the A/B tracker's own small tables and functions. SQL-text contract test (no database).
 *   Tables (all `ab_`, all in public, RLS on with no policy = service_role only, unit ids only):
 *     ab_card_lock, ab_assignment, ab_refresh_log, ab_rollup_unit_period, ab_stop_state
 *   Reads (run by the nightly job on the READ REPLICA; STABLE, 30 s): ab_tracker_live_tests, ab_tracker_metric_rows
 *   Writes (run on the primary; 15 s; touch ab_ tables only): ab_tracker_refresh_open, ab_tracker_upsert_rollup,
 *     ab_tracker_refresh_close
 * The tracker never references, triggers on or writes an app table; it only reads them (docs/ab-tracker-store.md).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DIR = path.join(ROOT, 'infrastructure/supabase/migrations');
const flat = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const read = (f) => flat(fs.readFileSync(path.join(DIR, f), 'utf8'));
const UP = read('V1.10.7__ab_tracker_tables.sql');
const DOWN = read('ROLLBACK_V1.10.7__ab_tracker_tables.sql');
const BASELINE = flat(fs.readFileSync(path.join(ROOT, 'supabase/baseline/schema.sql'), 'utf8'));
const OBJECTS = fs.readFileSync(path.join(ROOT, 'supabase/baseline/schema.objects.txt'), 'utf8').split('\n');

const TABLES = ['ab_card_lock', 'ab_assignment', 'ab_refresh_log', 'ab_rollup_unit_period', 'ab_stop_state'];
const READS = ['ab_tracker_live_tests', 'ab_tracker_metric_rows'];
const HELPERS = ['ab_tracker_unit_teachers'];
const WRITES = ['ab_tracker_refresh_open', 'ab_tracker_upsert_rollup', 'ab_tracker_refresh_close'];

/** The body of one function, from its CREATE to the closing $$. */
function body(name) {
  const at = UP.indexOf(`create or replace function public.${name}(`);
  if (at < 0) return '';
  const open = UP.indexOf('$$', at);
  return UP.slice(at, UP.indexOf('$$', open + 2) + 2);
}

test('every table is new, ab_-prefixed, in public, with a uuid id and RLS on', () => {
  for (const t of TABLES) {
    expect(UP).toContain(`create table if not exists public.${t} ( id uuid primary key default gen_random_uuid()`);
    expect(UP).toContain(`alter table public.${t} enable row level security`);
    expect(UP).toContain(`revoke all on public.${t} from anon, authenticated`);
  }
  const created = [...UP.matchAll(/create table if not exists (?:public\.)?(\w+)/g)].map((m) => m[1]);
  expect(created.sort()).toEqual([...TABLES].sort());
  expect(UP).not.toMatch(/create policy/);
  expect(UP).not.toMatch(/create schema/);
});

test('no foreign key, trigger or write reaches an app table', () => {
  for (const m of UP.matchAll(/references (?:public\.)?(\w+)/g)) expect(m[1]).toMatch(/^ab_/);
  expect(UP).not.toMatch(/create trigger/);
  for (const m of UP.matchAll(/(?:insert into|(?<!do )update|delete from|alter table|truncate) (?:public\.)?(\w+)/g)) {
    expect(m[1]).toMatch(/^ab_/);
  }
});

test('unit ids only: no name, phone or free-text person column', () => {
  expect(UP).not.toMatch(/\b\w*(phone|name|email|cnic)\w* (text|varchar|character)/);
});

test('rollup grain is test x unit x metric x period kind x period, with n, sum, sum of squares', () => {
  expect(UP).toMatch(/unique \(test_id, unit_id, metric_id, period_kind, period\)/);
  expect(UP).toMatch(/period_kind text not null check \(period_kind in \('day', 'week'\)\)/);
  expect(UP).toMatch(/n bigint not null check \(n >= 0\), s double precision not null, ss double precision not null/);
});

test('reads are STABLE, security invoker, 30 s, and only read', () => {
  for (const f of READS) {
    const b = body(f);
    expect(b).toMatch(/language (sql|plpgsql) stable security invoker set statement_timeout = '30s'/);
    expect(b).not.toMatch(/\b(insert into|update \w+ set|delete from|truncate)\b/);
  }
});

test('the metric reader knows the four database measures and refuses any other', () => {
  const b = body('ab_tracker_metric_rows');
  for (const m of ['plan_fidelity', 'teachers_coming_back', 'child_quiz_objectives_secured', 'send_failures']) expect(b).toContain(`'${m}'`);
  expect(b).toMatch(/raise exception 'ab_tracker_metric_rows: unknown metric/);
  expect(b).toContain("at time zone 'asia/karachi'");
  expect(b).toContain('returns jsonb');
});

test('writes are 15 s and touch only ab_ tables; the upsert is batched and capped', () => {
  for (const f of WRITES) {
    const b = body(f);
    expect(b).toMatch(/language plpgsql volatile security invoker set statement_timeout = '15s'/);
    for (const m of b.matchAll(/(?:insert into|(?<!do )update|delete from) (?:public\.)?(\w+)/g)) expect(m[1]).toMatch(/^ab_/);
  }
  const up = body('ab_tracker_upsert_rollup');
  expect(up).toContain('jsonb_to_recordset(p_rows)');
  expect(up).toContain('on conflict (test_id, unit_id, metric_id, period_kind, period) do update');
  expect(up).toMatch(/jsonb_array_length\(p_rows\) > 2000/);
});

test('the teacher helper is plain STABLE sql with no SET, so it is inlined into each measure query', () => {
  const b = body('ab_tracker_unit_teachers');
  expect(b).toMatch(/language sql stable security invoker as \$\$/);
  expect(b).not.toMatch(/\bset \w+ =|insert into|delete from/);
});

test('only service_role may call any function', () => {
  for (const f of [...READS, ...WRITES, ...HELPERS]) {
    expect(UP).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`));
    expect(UP).toMatch(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`));
  }
});

test('one transaction from the runner, PostgREST reloads, no BEGIN/COMMIT', () => {
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops exactly what the migration made, functions first, and nothing else', () => {
  for (const f of [...READS, ...WRITES, ...HELPERS]) expect(DOWN).toContain(`drop function if exists public.${f}(`);
  for (const t of TABLES) expect(DOWN).toContain(`drop table if exists public.${t}`);
  for (const m of DOWN.matchAll(/drop (?:table|function) if exists (?:public\.)?(\w+)/g)) expect(m[1]).toMatch(/^ab_/);
  expect(DOWN.indexOf('drop function')).toBeLessThan(DOWN.indexOf('drop table'));
});

test('the mock-lane baseline carries the tables and functions', () => {
  for (const t of TABLES) {
    expect(BASELINE).toContain(`create table public.${t} (`);
    expect(OBJECTS).toContain(`${t}.id:uuid`);
  }
  for (const f of [...READS, ...WRITES, ...HELPERS]) expect(BASELINE).toContain(`create function public.${f}(`);
});

test('teachers_coming_back is a weekly share in points: n = roster, s = 100 x takers, every week kept (bd-3kshar.6.3)', () => {
  const branch = (sql) => {
    const at = sql.indexOf("elsif p_metric_id = 'teachers_coming_back' then");
    return sql.slice(at, sql.indexOf('elsif p_metric_id', at + 10));
  };
  for (const b of [branch(UP), branch(BASELINE)]) {
    expect(b).toContain('roster as ( select t.arm, t.unit_id, t.block, count(*) as teachers from t');
    expect(b).toContain("generate_series(date_trunc('week', p_from::timestamp), p_to::timestamp, interval '1 week')");
    expect(b).toContain('ro.teachers as n');
    expect(b).toContain('(100.0 * coalesce(h.takers, 0))::double precision as s');
    expect(b).toContain('from roster ro cross join weeks left join hit h');
    expect(b).not.toContain('1 as n');
  }
});
