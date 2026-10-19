'use strict';
/**
 * V1.6.15 — niete_lp_opens admits plan_kind 'fln' and niete_fln_events exists.
 * SQL-text contract test (no database): the migration is applied by hand, re-run on
 * staging and production, so every statement must be a no-op the second time, and the
 * rollback must reverse each change. The real files are read from disk and parsed.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const UP = path.join(DIR, 'V1.6.15__niete_lp_opens_fln.sql');
const DOWN = path.join(DIR, 'ROLLBACK_V1.6.15__niete_lp_opens_fln.sql');

// Statements with comments stripped, lower-cased, whitespace collapsed.
const statements = (file) =>
  fs.readFileSync(file, 'utf8')
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);

const listOf = (sql) => {
  const m = sql.match(/in \(([^)]*)\)/);
  return m ? m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort() : null;
};

describe('V1.6.15 migration (up)', () => {
  let up;
  beforeAll(() => { up = statements(UP); });

  test('plan_kind CHECK lists exactly k5, g612, fln', () => {
    const add = up.find((s) => s.startsWith('alter table niete_lp_opens add constraint niete_lp_opens_plan_kind_check'));
    expect(add).toBeDefined();
    expect(listOf(add)).toEqual(['fln', 'g612', 'k5']);
  });

  test('the old CHECK is dropped IF EXISTS before it is re-added', () => {
    const drop = up.findIndex((s) => s === 'alter table niete_lp_opens drop constraint if exists niete_lp_opens_plan_kind_check');
    const add = up.findIndex((s) => s.startsWith('alter table niete_lp_opens add constraint niete_lp_opens_plan_kind_check'));
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(add).toBeGreaterThan(drop);
  });

  test('niete_fln_events has the contract columns and the four-kind CHECK', () => {
    const create = up.find((s) => s.startsWith('create table if not exists niete_fln_events'));
    expect(create).toBeDefined();
    expect(create).toMatch(/id bigserial primary key/);
    expect(create).toMatch(/created_at timestamptz not null default now\(\)/);
    expect(create).toMatch(/user_key text not null/);
    for (const col of ['plan_ref text', 'clip text', 'ms integer', 'result text', 'ua_class text']) {
      expect(create).toContain(col);
    }
    expect(listOf(create)).toEqual(['link_copy', 'open_link', 'send', 'share']); // audio telemetry goes to logs, not this table
  });

  test('index on created_at and RLS on the new table', () => {
    expect(up).toContain('create index if not exists niete_fln_events_created_idx on niete_fln_events (created_at)');
    expect(up).toContain('alter table niete_fln_events enable row level security');
  });

  test('every DDL statement is idempotent', () => {
    const ddl = up.filter((s) => /^(create|drop|alter table \S+ (add|drop))/.test(s) && !s.startsWith('alter table niete_lp_opens add constraint'));
    for (const s of ddl) {
      expect(s).toMatch(/if (not )?exists/);
    }
    // the ADD CONSTRAINT is only re-runnable because it directly follows DROP ... IF EXISTS
    expect(up.some((s) => /^drop constraint|^alter table niete_lp_opens drop constraint if exists/.test(s))).toBe(true);
  });

  test('depends on V1.6.1 only: references no table other than niete_lp_opens / niete_fln_events', () => {
    const text = fs.readFileSync(UP, 'utf8').replace(/--[^\n]*/g, '');
    expect(text).not.toMatch(/references\s/i);
    expect(text).not.toMatch(/lp_lifecycle|lp_dashboard|lesson_plan_versions/i);
  });

  test('documents why a send row keys the sender in user_key and the recipient in clip', () => {
    const raw = fs.readFileSync(UP, 'utf8');
    expect(raw).toMatch(/SENDER/);
    expect(raw).toMatch(/recipient/i);
  });
});

describe('ROLLBACK_V1.6.15 (down)', () => {
  let down;
  beforeAll(() => { down = statements(DOWN); });

  test('deletes fln rows before restoring the two-value CHECK', () => {
    const del = down.findIndex((s) => s === "delete from niete_lp_opens where plan_kind = 'fln'");
    const add = down.findIndex((s) => s.startsWith('alter table niete_lp_opens add constraint niete_lp_opens_plan_kind_check'));
    expect(del).toBeGreaterThanOrEqual(0);
    expect(add).toBeGreaterThan(del);
    expect(listOf(down[add])).toEqual(['g612', 'k5']);
  });

  test('drops the old CHECK IF EXISTS first and niete_fln_events IF EXISTS', () => {
    const drop = down.findIndex((s) => s === 'alter table niete_lp_opens drop constraint if exists niete_lp_opens_plan_kind_check');
    const add = down.findIndex((s) => s.startsWith('alter table niete_lp_opens add constraint'));
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(drop).toBeLessThan(add);
    expect(down).toContain('drop index if exists niete_fln_events_created_idx');
    expect(down).toContain('drop table if exists niete_fln_events');
  });
});
