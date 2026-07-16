/**
 * Guards that the fresh-install schema mirror (00_complete-schema.sql) has
 * the same core objects as the V1.0.7 attendance migration. Catches the
 * "migration added a table but the mirror didn't" bug class.
 */
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(__dirname, '../../infrastructure/supabase/migrations/V1.0.7__teacher_attendance.sql');
const mirrorPath = path.join(__dirname, '../../infrastructure/supabase/00_complete-schema.sql');

const migration = fs.readFileSync(migrationPath, 'utf8');
const mirror = fs.readFileSync(mirrorPath, 'utf8');

describe('V1.0.7 attendance schema — migration ↔ mirror parity', () => {
  const requiredObjects = [
    'CREATE TABLE IF NOT EXISTS schools',
    'CREATE TABLE IF NOT EXISTS teacher_attendance_records',
    'idx_schools_region',
    'idx_schools_principal',
    'idx_teacher_attendance_school_date',
    'idx_teacher_attendance_teacher_date',
    'teacher_attendance_status_valid',
    'teacher_attendance_leave_type_valid',
    'schools_read_all',
    'teacher_attendance_read_own',
  ];

  test.each(requiredObjects)('migration contains %s', (obj) => {
    expect(migration).toContain(obj);
  });

  test.each(requiredObjects)('mirror contains %s', (obj) => {
    expect(mirror).toContain(obj);
  });

  test('mirror has users.school_id + users.role columns', () => {
    // users table declares them inline (not via ALTER); check the DDL block.
    expect(mirror).toMatch(/school_id UUID/);
    expect(mirror).toMatch(/role VARCHAR\(32\)/);
  });

  test('migration adds ALTER TABLE users for school_id + role', () => {
    expect(migration).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id/);
    expect(migration).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS role/);
  });
});
