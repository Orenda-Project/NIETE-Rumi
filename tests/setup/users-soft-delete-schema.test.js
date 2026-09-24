/**
 * users.deleted_at — a column the sandbox database has and this branch never declared.
 *
 * It comes from V1.4.6__soft_delete_convention.sql: the three-column soft-delete
 * convention (deleted_at / deleted_reason / deleted_by), the `add_soft_delete(table)`
 * helper, and its application to `users`. That migration was applied to the sandbox
 * database from its feature branch and merged towards production, but the file never
 * reached this branch — so a clone bootstrapped from here has no users.deleted_at, and
 * code that wants to filter retired teachers in SQL has to read `*` and filter in JS
 * instead of naming the column.
 *
 * Asserted here: the migration file is present (so the ledger audit can check it on
 * every environment), and 00_complete-schema.sql declares everything it creates, in a
 * form the text-based conformance guards can see (explicit ADD COLUMNs, not only the
 * helper call).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATION = path.join(ROOT, 'infrastructure', 'supabase', 'migrations',
  'V1.4.6__soft_delete_convention.sql');
const SCHEMA = path.join(ROOT, 'infrastructure', 'supabase', '00_complete-schema.sql');

/** `--` comments stripped, whitespace collapsed — so a comment can never satisfy a check. */
function code(sqlText) {
  return sqlText.split('\n').map((l) => l.replace(/--.*$/, '')).join(' ').replace(/\s+/g, ' ');
}

/** The add_soft_delete function definition, from CREATE to its closing dollar-quote. */
function fnBody(sqlText) {
  const m = code(sqlText).match(/CREATE OR REPLACE FUNCTION add_soft_delete\(p_table text\)[\s\S]*?\$fn\$[\s\S]*?\$fn\$;/i);
  return m ? m[0] : null;
}

const COLUMNS = [
  ['deleted_at', 'timestamptz'],
  ['deleted_reason', 'text'],
  ['deleted_by', 'text'],
];

describe('V1.4.6 soft-delete convention — present on this branch', () => {
  let sql;
  beforeAll(() => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
    sql = fs.readFileSync(MIGRATION, 'utf8');
  });

  test('defines add_soft_delete, which adds all three columns and a partial index', () => {
    const body = fnBody(sql);
    expect(body).not.toBeNull();
    for (const [col, type] of COLUMNS) {
      expect(body).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col} ${type}`, 'i'));
    }
    expect(body).toMatch(/WHERE deleted_at IS NOT NULL/i);
  });

  test('applies it to users', () => {
    expect(code(sql)).toMatch(/SELECT add_soft_delete\('users'\);/i);
  });

  test('no other migration file claims 1.4.6', () => {
    const same = fs.readdirSync(path.dirname(MIGRATION)).filter((f) => f.startsWith('V1.4.6__'));
    expect(same).toEqual(['V1.4.6__soft_delete_convention.sql']);
  });
});

describe('00_complete-schema.sql declares what V1.4.6 creates', () => {
  let schema;
  beforeAll(() => { schema = code(fs.readFileSync(SCHEMA, 'utf8')); });

  test.each(COLUMNS)('users.%s (%s)', (col, type) => {
    expect(schema).toMatch(new RegExp(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col} ${type};`, 'i'));
  });

  test('the partial tombstone index on users.deleted_at', () => {
    expect(schema).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users \(deleted_at\) WHERE deleted_at IS NOT NULL;/i,
    );
  });

  test('the add_soft_delete helper, identical to the migration', () => {
    const want = fnBody(fs.readFileSync(MIGRATION, 'utf8'));
    expect(want).not.toBeNull();
    expect(fnBody(fs.readFileSync(SCHEMA, 'utf8'))).toBe(want);
  });
});
