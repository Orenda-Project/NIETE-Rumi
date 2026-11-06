'use strict';
/**
 * V1.9.2 — GB's own lesson-plan cache (bd-rj6w0n.14.16). SQL-text contract test (no database).
 * GB never shares niete_lp612_renders or the lp612/ prefix: its own table, its own key prefix, its own RPCs.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('V1.9.2__gb_lp_renders.sql');
const DOWN = read('ROLLBACK_V1.9.2__gb_lp_renders.sql');

test('creates GB its own render table, keyed like 6-12 but never pointing at lp612/', () => {
  expect(UP).toContain('create table if not exists niete_gb_lp_renders');
  expect(UP).toContain('unique (segment_id, lang, template_version)');
  expect(UP).toContain("r2_key like 'gb-lp/%'");
  expect(UP).toContain('references niete_lp612_segments(segment_id)');
  expect(UP).toContain('enable row level security');
});

test('never touches the ICT render table', () => {
  expect(UP).not.toMatch(/(alter|update|insert into|delete from|drop)[^;]*niete_lp612_renders/);
});

test('ships its own atomic join and claim RPCs on its own table', () => {
  expect(UP).toContain('create or replace function gb_lp_join_waiters(p_render_id uuid, p_entry jsonb)');
  expect(UP).toContain('create or replace function gb_lp_claim_waiters(p_render_id uuid)');
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops exactly what it created', () => {
  expect(DOWN).toContain('drop table if exists niete_gb_lp_renders');
  expect(DOWN).toContain('drop function if exists gb_lp_join_waiters(uuid, jsonb)');
  expect(DOWN).toContain('drop function if exists gb_lp_claim_waiters(uuid)');
  expect(DOWN).not.toMatch(/niete_lp612_renders/);
});
