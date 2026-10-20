'use strict';
/**
 * V1.6.18 — assessment_topics table + paper_kind on assessment_requests/assessment_papers.
 * SQL-text contract test (no database). Access mirrors niete_lp612_segments (V1.2.8): no RLS, no grants.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('V1.6.18__assessment_topics.sql');
const DOWN = read('ROLLBACK_V1.6.18__assessment_topics.sql');

test('creates assessment_topics idempotently with the agreed columns', () => {
  expect(UP).toContain('create table if not exists assessment_topics');
  for (const col of [
    'topic_id text primary key', 'grade integer', 'subject text', 'chapter_number integer', 'chapter_title text',
    'name text', 'heading text', 'heading_order integer', 'sort_order integer', 'pages integer[]',
    'slo_codes text[]', 'slo_descriptions text[]', 'days integer[]', 'is_current boolean', 'matrix_version text',
    'updated_at timestamptz',
  ]) expect(UP).toContain(col);
  expect(UP).toMatch(/is_current boolean not null default true/);
});

test('current-rows index on (grade, subject, chapter_number)', () => {
  expect(UP).toMatch(/create index if not exists \w+ on assessment_topics \(grade, subject, chapter_number\) where is_current/);
});

test.each(['assessment_requests', 'assessment_papers'])('%s gets paper_kind with the check', (t) => {
  expect(UP).toMatch(new RegExp(`alter table ${t} add column if not exists paper_kind text not null default 'chapter' check \\(paper_kind in \\('chapter', ?'topic', ?'pattern'\\)\\)`));
});

test('no RLS or grants, as niete_lp612_segments', () => {
  expect(UP).not.toMatch(/row level security|create policy|grant /);
});

test('reloads PostgREST last, up and down', () => {
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  expect(DOWN.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops exactly what the forward adds', () => {
  const stmts = DOWN.split(';').map((s) => s.trim()).filter(Boolean);
  expect(stmts).toEqual([
    'alter table assessment_papers drop column if exists paper_kind',
    'alter table assessment_requests drop column if exists paper_kind',
    expect.stringMatching(/^drop index if exists \w+$/),
    'drop table if exists assessment_topics',
    "notify pgrst, 'reload schema'",
  ]);
  const idx = UP.match(/create index if not exists (\w+) on assessment_topics/)[1];
  expect(DOWN).toContain(`drop index if exists ${idx}`);
});
