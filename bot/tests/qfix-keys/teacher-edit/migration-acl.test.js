'use strict';
// The teacher-edit audit table is written by the service role only. A tier whose default privileges grant new tables to
// anon/authenticated (staging does: arwdDxtm, TRUNCATE included, which RLS does not filter) must end with those roles
// holding nothing on it, and the migration must refuse to finish if they still do.
const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(__dirname, '../../../database/migrations/qfix_keys_teacher_edit.sql');
const MIRROR = path.join(__dirname, '../../../../infrastructure/supabase/00_complete-schema.sql');
const sql = fs.readFileSync(MIGRATION, 'utf8');
const mirror = fs.readFileSync(MIRROR, 'utf8');

const REVOKE = /REVOKE ALL ON TABLE public\.quiz_teacher_edits FROM PUBLIC, anon, authenticated;/;

describe('qfix_keys_teacher_edit.sql: client roles hold nothing on the audit table', () => {
  test('revokes every table privilege from PUBLIC, anon and authenticated, after the table exists', () => {
    expect(sql).toMatch(REVOKE);
    expect(sql.search(REVOKE)).toBeGreaterThan(sql.indexOf('CREATE TABLE IF NOT EXISTS public.quiz_teacher_edits'));
  });

  test('ends with a guard that raises if a client role keeps any table privilege or EXECUTE on the functions', () => {
    const guard = sql.slice(sql.lastIndexOf('DO $guard$'));
    expect(sql.lastIndexOf('DO $guard$')).toBeGreaterThan(sql.lastIndexOf('GRANT EXECUTE ON FUNCTION'));
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) expect(guard).toContain(`'${p}'`);
    expect(guard).toMatch(/'anon'\s*,\s*'authenticated'/);
    expect(guard).toMatch(/has_table_privilege\(/);
    expect(guard).toMatch(/has_function_privilege\([^)]*'EXECUTE'\)/);
    for (const f of ['quiz_teacher_edit_apply', 'quiz_teacher_edit_pdf', 'quiz_teacher_edit_words']) expect(guard).toContain(`'${f}'`);
    expect(guard).toMatch(/relrowsecurity/);
    expect(guard).toMatch(/RAISE EXCEPTION/);
  });

  test('the table comment names its readers instead of claiming service role only', () => {
    const comment = sql.match(/COMMENT ON TABLE public\.quiz_teacher_edits IS '([^']*)'/)[1];
    expect(comment).not.toMatch(/Service role only/);
    expect(comment).toMatch(/analyst/);
    expect(comment).toMatch(/no client roles/);
  });

  test('the schema mirror carries the same revoke and comment', () => {
    expect(mirror).toMatch(REVOKE);
    const comment = sql.match(/COMMENT ON TABLE public\.quiz_teacher_edits IS '[^']*';/)[0];
    expect(mirror).toContain(comment);
  });
});
