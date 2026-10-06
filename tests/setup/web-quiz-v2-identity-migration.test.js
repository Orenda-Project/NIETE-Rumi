/**
 * The web quiz's hand-out binding: one nullable column on quiz_share_codes says which class a
 * hand-out (a class code) was for, so the children who open it are matched inside that ONE
 * class and the teacher's report can list who has not played.
 *
 * Additive and nullable, so it is safe hours before the code that reads it — and the code
 * tolerates its absence (42703) until it is applied. The rollback removes exactly what the
 * forward file adds. A clone bootstraps from 00_complete-schema.sql alone, so the reference
 * schema declares quiz_share_codes itself (from the video-quiz migration) with the new column.
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

  it('is mirrored in 00_complete-schema.sql with the table it alters (a clone bootstraps from that file alone)', () => {
    const schema = code(read(SCHEMA));
    const at = schema.search(/CREATE TABLE IF NOT EXISTS quiz_share_codes \(/);
    expect(at).toBeGreaterThan(-1);
    const table = schema.slice(at, schema.indexOf(');', at));
    ['id', 'code', 'quiz_id', 'teacher_user_id', 'video_id', 'teacher_name', 'topic', 'language', 'active', 'uses_count',
      'expires_at', 'created_at', 'report_sent_at', 'invited_by_student_id', 'parent_share_code_id']
      .forEach((col) => expect(table).toMatch(new RegExp(`\\n\\s*${col}\\s`)));
    expect(table).toMatch(/class_id\s+uuid REFERENCES classes\(id\)/i);
    expect(schema).toMatch(/CREATE INDEX IF NOT EXISTS idx_quiz_share_codes_class\s+ON quiz_share_codes\s*\(class_id\)\s+WHERE class_id IS NOT NULL/i);
  });
});
