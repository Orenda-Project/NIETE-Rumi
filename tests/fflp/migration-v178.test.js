'use strict';
/**
 * The free-form track lives on the request row as textbook_metadata.fflp_track (F50), the same jsonb the
 * main bot's lesson_plan_requests already has. This deployment's request table has no such column, so
 * V1.7.8 adds it: nullable, no default, no backfill (every existing row stays as it is). The earlier
 * V1.7.7 (a source CHECK swap for a 'freeform_v1' source) is gone: nothing writes that source any more.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DIR = path.join(ROOT, 'infrastructure/supabase/migrations');
const readIf = (f) => (fs.existsSync(path.join(DIR, f)) ? fs.readFileSync(path.join(DIR, f), 'utf8') : '');
const FORWARD = 'V1.7.8__lp_requests_textbook_metadata.sql';
const ROLLBACK = 'ROLLBACK_V1.7.8__lp_requests_textbook_metadata.sql';
const LOCK = /set_config\('lock_timeout',\s*'5s',\s*true\)/;

test('forward adds a nullable textbook_metadata jsonb to lesson_plan_requests, idempotently, and nothing else', () => {
  const sql = readIf(FORWARD);
  expect(sql).toMatch(/ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS textbook_metadata jsonb;/i);
  expect(sql).not.toMatch(/NOT NULL|DEFAULT|UPDATE lesson_plan_requests|DROP CONSTRAINT/i);
  expect(sql).toMatch(/COMMENT ON COLUMN lesson_plan_requests\.textbook_metadata/i);
});

test.each([[FORWARD], [ROLLBACK]])('%s sets lock_timeout before it alters the table', (file) => {
  const sql = readIf(file);
  const lock = sql.search(LOCK);
  expect(lock).toBeGreaterThanOrEqual(0);
  expect(sql.indexOf('ALTER TABLE')).toBeGreaterThan(lock);
});

test('rollback refuses while any row holds data in the column, then drops the column and its ledger row', () => {
  const sql = readIf(ROLLBACK);
  expect(sql).toMatch(/WHERE textbook_metadata IS NOT NULL/);
  expect(sql).toMatch(/DROP COLUMN IF EXISTS textbook_metadata/i);
  expect(sql).toMatch(/DELETE FROM schema_versions WHERE version = '1\.7\.8'/);
});

test('the reference schema has the column; the V1.7.7 source-CHECK files are gone', () => {
  const ref = fs.readFileSync(path.join(ROOT, 'infrastructure/supabase/00_complete-schema.sql'), 'utf8');
  expect(ref).toMatch(/ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS textbook_metadata JSONB;/);
  expect(fs.existsSync(path.join(DIR, 'V1.7.7__lp_source_freeform.sql'))).toBe(false);
  expect(fs.existsSync(path.join(DIR, 'ROLLBACK_V1.7.7__lp_source_freeform.sql'))).toBe(false);
});
