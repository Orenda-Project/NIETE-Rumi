'use strict';
/**
 * V1.10.11 — niete_lp_opens.lesson_key (bd-chz35n.26). SQL-text contract (no database): re-runnable, reversible,
 * and the writer's keyed insert names exactly this column.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const statements = (name) => fs.readFileSync(path.join(DIR, name), 'utf8')
  .replace(/--[^\n]*/g, '').split(';').map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);

test('up: one nullable text column, added IF NOT EXISTS, commented, schema reloaded; no transaction control', () => {
  const up = statements('V1.10.11__niete_lp_opens_lesson_key.sql');
  expect(up[0]).toBe('alter table niete_lp_opens add column if not exists lesson_key text');
  expect(up.some((s) => s.startsWith('comment on column niete_lp_opens.lesson_key is'))).toBe(true);
  expect(up[up.length - 1]).toBe("notify pgrst, 'reload schema'");
  expect(up.join(' ')).not.toMatch(/\b(begin|commit|not null|default)\b/);
});

test('rollback drops the column IF EXISTS', () => {
  const down = statements('ROLLBACK_V1.10.11__niete_lp_opens_lesson_key.sql');
  expect(down[0]).toBe('alter table niete_lp_opens drop column if exists lesson_key');
});

test('the writer inserts into this column name', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/services/lp-activity.service.js'), 'utf8');
  expect(src).toMatch(/plan_ref, lang, source, lesson_key\)/);
});
