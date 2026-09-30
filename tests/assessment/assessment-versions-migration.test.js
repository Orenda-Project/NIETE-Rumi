/**
 * V1.5.6 — paper versions are ONE column on assessment_papers, not a table.
 *
 * A teacher edits a paper on WhatsApp, repeatedly, and may edit ANY version.
 * Until now the one row was rewritten in place, so the paper as generated was
 * lost. A version is exactly what a paper row already is (a tree, a file, a
 * key, counts, a status), so a version is a new row that names the row it was
 * edited from. `request_id` already groups the family and is indexed; the
 * version NUMBER is worked out, never stored.
 *
 * These pins are static (the migration runs on Supabase, not in Jest), and they
 * pin the parts that are dangerous to get wrong: the unique constraint is found
 * by DEFINITION rather than a guessed name, versions are excluded from it, the
 * flag defaults OFF, and the rollback renumbers versions BEFORE restoring the
 * old uniqueness (restoring it first would fail on every family with a version).
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'infrastructure', 'supabase', 'migrations');
const FILE = path.join(DIR, 'V1.5.6__assessment_paper_versions.sql');
const ROLLBACK = path.join(DIR, 'ROLLBACK_V1.5.6__assessment_paper_versions.sql');
const SCHEMA = path.join(__dirname, '..', '..', 'infrastructure', 'supabase', '00_complete-schema.sql');

// Comments name the things the SQL does; strip them so a pin cannot pass on prose.
const code = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
const read = (f) => fs.readFileSync(f, 'utf8');

describe('V1.5.6__assessment_paper_versions.sql', () => {
  test('exists, alone at its version number', () => {
    expect(fs.existsSync(FILE)).toBe(true);
    expect(fs.readdirSync(DIR).filter((f) => f.startsWith('V1.5.6__'))).toEqual(['V1.5.6__assessment_paper_versions.sql']);
  });

  const sql = () => code(read(FILE));

  test('adds edited_from as a UUID self-reference, idempotently', () => {
    expect(sql()).toMatch(/ALTER TABLE assessment_papers ADD COLUMN IF NOT EXISTS edited_from UUID REFERENCES assessment_papers\(id\)/i);
  });

  test('a row can never name itself', () => {
    expect(sql()).toMatch(/CHECK \(edited_from IS NULL OR edited_from <> id\)/i);
  });

  test('drops UNIQUE (request_id, attempt) found by its definition, not a guessed name', () => {
    expect(sql()).toMatch(/pg_get_constraintdef\(oid\) = 'UNIQUE \(request_id, attempt\)'/);
    expect(sql()).toMatch(/DROP CONSTRAINT %I/);
  });

  test('uniqueness now covers generated rows only — a version inherits its parent\'s attempt', () => {
    expect(sql()).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_papers_request_attempt_generated ON assessment_papers \(request_id, attempt\) WHERE edited_from IS NULL/i);
  });

  test('the foreign key is indexed (partial: most rows are roots)', () => {
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_assessment_papers_edited_from ON assessment_papers \(edited_from\) WHERE edited_from IS NOT NULL/i);
  });

  test('the column is documented with its classification', () => {
    expect(read(FILE)).toMatch(/COMMENT ON COLUMN assessment_papers\.edited_from IS\s+'Internal\./);
  });

  test('seeds the transitional flag OFF, and never overwrites a value set by hand', () => {
    expect(sql()).toMatch(/INSERT INTO app_settings \(key, value, description\) VALUES \('assessment_versions_enabled', 'false'::jsonb,/i);
    expect(sql()).toMatch(/ON CONFLICT \(key\) DO NOTHING/i);
  });

  test('runs in one transaction and tells PostgREST to reload', () => {
    expect(sql()).toMatch(/^ ?BEGIN;.*COMMIT;/);
    expect(sql().trim()).toMatch(/NOTIFY pgrst, 'reload schema';$/);
  });
});

describe('ROLLBACK_V1.5.6__assessment_paper_versions.sql', () => {
  const sql = () => code(read(ROLLBACK));

  test('exists', () => {
    expect(fs.existsSync(ROLLBACK)).toBe(true);
  });

  test('renumbers versions to 1000+ BEFORE restoring UNIQUE (request_id, attempt)', () => {
    const s = sql();
    const renumber = s.search(/UPDATE assessment_papers p SET attempt = v\.a/i);
    const restore = s.search(/ADD CONSTRAINT assessment_papers_request_id_attempt_key UNIQUE \(request_id, attempt\)/i);
    expect(renumber).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(-1);
    expect(renumber).toBeLessThan(restore);
    expect(s).toMatch(/1000 \+ ROW_NUMBER\(\) OVER \(PARTITION BY request_id ORDER BY created_at, id\)/i);
  });

  test('removes everything V1.5.6 added, and deletes no paper row', () => {
    const s = sql();
    expect(s).toMatch(/DROP INDEX IF EXISTS uq_assessment_papers_request_attempt_generated/i);
    expect(s).toMatch(/DROP INDEX IF EXISTS idx_assessment_papers_edited_from/i);
    expect(s).toMatch(/DROP CONSTRAINT IF EXISTS assessment_papers_edited_from_not_self/i);
    expect(s).toMatch(/DROP COLUMN IF EXISTS edited_from/i);
    expect(s).toMatch(/DELETE FROM app_settings WHERE key = 'assessment_versions_enabled'/i);
    expect(s).not.toMatch(/DELETE FROM assessment_papers/i);
  });
});

describe('00_complete-schema.sql mirrors V1.5.6', () => {
  const schema = () => code(read(SCHEMA));
  test('declares edited_from, the not-self check and the partial unique index — and no longer the table-level UNIQUE', () => {
    const s = schema();
    const table = s.match(/CREATE TABLE IF NOT EXISTS assessment_papers \((.*?)\);/i)[1];
    expect(table).toMatch(/edited_from UUID REFERENCES assessment_papers\(id\)/i);
    expect(table).toMatch(/CONSTRAINT assessment_papers_edited_from_not_self CHECK \(edited_from IS NULL OR edited_from <> id\)/i);
    expect(table).not.toMatch(/UNIQUE \(request_id, attempt\)/i);
    expect(s).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_papers_request_attempt_generated ON assessment_papers \(request_id, attempt\) WHERE edited_from IS NULL/i);
    expect(s).toMatch(/CREATE INDEX IF NOT EXISTS idx_assessment_papers_edited_from ON assessment_papers \(edited_from\) WHERE edited_from IS NOT NULL/i);
  });
});
