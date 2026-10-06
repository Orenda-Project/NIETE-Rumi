/**
 * The web quiz's hand-out binding: one nullable column on quiz_share_codes says which class a
 * hand-out (a class code) was for, so the children who open it are matched inside that ONE
 * class and the teacher's report can list who has not played.
 *
 * Additive and nullable, so it is safe hours before the code that reads it — and the code
 * tolerates its absence (42703) until it is applied. The rollback removes exactly what the
 * forward file adds. A clone bootstraps from 00_complete-schema.sql, which does not declare
 * quiz_share_codes (it arrives with the video-quiz migrations), so the mirror there is guarded
 * on the table existing.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'bot', 'database', 'migrations');
const FORWARD = path.join(DIR, 'web_quiz_v2_identity.sql');
const ROLLBACK = path.join(DIR, 'web_quiz_v2_identity_rollback.sql');
const SCHEMA = path.join(ROOT, 'infrastructure', 'supabase', '00_complete-schema.sql');

const read = (f) => fs.readFileSync(f, 'utf8');
const code = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

describe('web_quiz_v2_identity migration', () => {
  it('exists beside web_quiz_v1, with its rollback', () => {
    expect(fs.existsSync(FORWARD)).toBe(true);
    expect(fs.existsSync(ROLLBACK)).toBe(true);
  });

  it('adds ONE nullable column referencing classes, idempotently', () => {
    const sql = code(read(FORWARD));
    expect(sql).toMatch(/ALTER TABLE (public\.)?quiz_share_codes\s+ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES (public\.)?classes\(id\)/i);
    expect(sql.match(/ADD COLUMN[^;]*/i)[0]).not.toMatch(/NOT NULL|DEFAULT/i);
    expect((sql.match(/ADD COLUMN/gi) || []).length).toBe(1);
  });

  it('indexes only the bound hand-outs', () => {
    expect(code(read(FORWARD))).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_quiz_share_codes_class\s+ON (public\.)?quiz_share_codes\s*\(class_id\)\s+WHERE class_id IS NOT NULL/i,
    );
  });

  it('is additive: nothing dropped, updated or deleted, no backfill', () => {
    expect(code(read(FORWARD))).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME)\b/i);
  });

  it('rolls back exactly what it added', () => {
    const sql = code(read(ROLLBACK));
    expect(sql).toMatch(/DROP INDEX IF EXISTS (public\.)?idx_quiz_share_codes_class/i);
    expect(sql).toMatch(/ALTER TABLE (public\.)?quiz_share_codes\s+DROP COLUMN IF EXISTS class_id/i);
    expect(sql.indexOf('DROP INDEX')).toBeLessThan(sql.indexOf('DROP COLUMN'));
  });

  it('is mirrored in 00_complete-schema.sql, guarded on the table a clone may not have yet', () => {
    const schema = read(SCHEMA);
    const at = schema.indexOf('web_quiz_v2_identity.sql');
    expect(at).toBeGreaterThan(-1);
    const block = schema.slice(at, at + 1500);
    expect(block).toMatch(/to_regclass\('public\.quiz_share_codes'\) IS NOT NULL/i);
    expect(block).toMatch(/ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES (public\.)?classes\(id\)/i);
    expect(block).toMatch(/idx_quiz_share_codes_class/);
  });
});
