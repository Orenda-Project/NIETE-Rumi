/**
 * Roster and config auditing — the half of record_history nobody notices working.
 *
 * These tables barely change (schools: 1 update in the window, class_teachers: 5),
 * so the cost is nil and the tests are not about volume. They are about the two
 * ways this batch can be silently wrong: addressing a row by a key it does not
 * have, and watching a column name that does not exist.
 *
 * app_settings is the reason the trigger function had to change at all. Its
 * primary key is `key text`; attaching the original function to it failed against
 * staging with `record "new" has no field "id"`. Every case below that touches a
 * key column encodes that failure.
 */
const {
  WATCHED, KEY_COLUMN, diffWatched, rowKey, isAudited,
} = require('../../scripts/row-history-audit');

const eq = (a, b) => expect(a).toEqual(b);
const t = (name, fn) => it(name, fn);

describe('roster + config history', () => {

// ── the app_settings case: a natural text key, not a uuid ────────────────────

t('addresses app_settings by its text key, not id', () => {
  eq(KEY_COLUMN.app_settings, 'key');
  eq(rowKey('app_settings', { key: 'rdf_active_snapshot', value: {} }), 'rdf_active_snapshot');
});

t('a row with no id at all still yields a key', () => {
  // The exact shape that broke the original trigger.
  const row = { key: 'rdf_niete_actions_state', value: { posted: [] } };
  eq(row.id, undefined);
  eq(rowKey('app_settings', row), 'rdf_niete_actions_state');
});

t('records a config value being overwritten in place', () => {
  const d = diffWatched('app_settings',
    { key: 'rdf_active_snapshot', value: { active_week: 2254 } },
    { key: 'rdf_active_snapshot', value: { active_week: 2301 } });
  eq(d.changed_cols, ['value']);
  eq(d.old_vals.value.active_week, 2254);
  eq(d.new_vals.value.active_week, 2301);
});

t('an unchanged config write records nothing', () => {
  eq(diffWatched('app_settings',
    { key: 'k', value: { a: 1 } }, { key: 'k', value: { a: 1 } }), null);
});

// ── uuid-keyed tables keep working, as text ──────────────────────────────────

t('a uuid key is carried as its text form', () => {
  const id = '3f2b9c1e-0000-4000-8000-000000000001';
  eq(rowKey('schools', { id }), id);
});

t('every audited table has a key column declared', () => {
  for (const table of Object.keys(WATCHED)) {
    expect(KEY_COLUMN[table]).toBeTruthy();
  }
});

t('a missing key column is an error, not a null row_id', () => {
  expect(() => rowKey('not_a_table', {})).toThrow(/no key column/);
});

t('a row missing its declared key yields null so the trigger can raise', () => {
  eq(rowKey('schools', {}), null);
});

// ── schools: the column name that was wrong on the first pass ────────────────

t('watches emis, not emis_code', () => {
  // The live column is `emis`. `emis_code` does not exist on this table.
  expect(WATCHED.schools).toContain('emis');
  expect(WATCHED.schools).not.toContain('emis_code');
});

t('records a school being deactivated', () => {
  const d = diffWatched('schools',
    { id: 's1', name: 'GPS Chak 12', is_active: true },
    { id: 's1', name: 'GPS Chak 12', is_active: false });
  eq(d.changed_cols, ['is_active']);
  eq(d.old_vals.is_active, true);
});

t('records a school being reassigned to another principal', () => {
  const d = diffWatched('schools',
    { id: 's1', principal_user_id: 'u1', region: 'Punjab' },
    { id: 's1', principal_user_id: 'u2', region: 'Punjab' });
  eq(d.changed_cols, ['principal_user_id']);
});

// ── enrolment: a closed row is a child removed from a register ───────────────

t('records an enrolment being closed', () => {
  const d = diffWatched('class_enrollments',
    { id: 'e1', is_active: true, class_id: 'c1', student_id: 'st1' },
    { id: 'e1', is_active: false, class_id: 'c1', student_id: 'st1' });
  eq(d.changed_cols, ['is_active']);
});

t('records a child being moved between classes', () => {
  const d = diffWatched('class_enrollments',
    { id: 'e1', is_active: true, class_id: 'c1', student_id: 'st1' },
    { id: 'e1', is_active: true, class_id: 'c2', student_id: 'st1' });
  eq(d.changed_cols, ['class_id']);
  eq(d.old_vals.class_id, 'c1');
});

// ── students: 460 rows sit in 'merged' with no record of what merged ─────────

t('records the merge that deactivates a duplicate child', () => {
  const d = diffWatched('students',
    { id: 'st1', student_name: 'Ayesha', status: 'active', is_active: true },
    { id: 'st1', student_name: 'Ayesha', status: 'merged', is_active: false });
  eq(d.changed_cols.sort(), ['is_active', 'status']);
  eq(d.new_vals.status, 'merged');
});

t('records a name correction on a register', () => {
  const d = diffWatched('students',
    { id: 'st1', student_name: 'Ayesha', father_name: 'Bilal', roll_number: 12 },
    { id: 'st1', student_name: 'Ayesha Bibi', father_name: 'Bilal', roll_number: 12 });
  eq(d.changed_cols, ['student_name']);
});

t('ignores unwatched student columns', () => {
  eq(diffWatched('students',
    { id: 'st1', status: 'active', updated_at: '2026-09-01' },
    { id: 'st1', status: 'active', updated_at: '2026-09-03' }), null);
});

// ── the remaining roster tables ──────────────────────────────────────────────

t('records a teacher losing class-teacher status', () => {
  const d = diffWatched('class_teachers',
    { id: 'ct1', is_active: true, is_class_teacher: true },
    { id: 'ct1', is_active: true, is_class_teacher: false });
  eq(d.changed_cols, ['is_class_teacher']);
});

t('records an attendance status and its leave reason together', () => {
  const d = diffWatched('teacher_attendance_records',
    { id: 'a1', status: 'present', leave_type: null, school_id: 's1' },
    { id: 'a1', status: 'leave', leave_type: 'casual', school_id: 's1' });
  eq(d.changed_cols.sort(), ['leave_type', 'status']);
});

t('records a training assignment being revoked and by whom', () => {
  const d = diffWatched('teacher_training_assignments',
    { id: 'ta1', is_active: true, assigned_by: 'u1' },
    { id: 'ta1', is_active: false, assigned_by: 'u2' });
  eq(d.changed_cols.sort(), ['assigned_by', 'is_active']);
});

t('records a student list being archived', () => {
  eq(diffWatched('student_lists', { id: 'sl1', is_active: true },
                                  { id: 'sl1', is_active: false }).changed_cols, ['is_active']);
});

t('records an exam-check session status change', () => {
  eq(diffWatched('exam_check_sessions', { id: 'x1', status: 'pending' },
                                        { id: 'x1', status: 'completed' }).changed_cols, ['status']);
});

// ── coverage: the batch is 14 tables, 60 columns ─────────────────────────────

t('all 14 tables are audited', () => {
  eq(Object.keys(WATCHED).length, 14);
});

t('59 columns are watched in total', () => {
  // 60 minus coaching_sessions.conversation_state, dropped on production evidence.
  eq(Object.values(WATCHED).reduce((n, c) => n + c.length, 0), 59);
});

t('the 9 roster/config tables are all registered', () => {
  for (const table of ['app_settings','class_enrollments','students','student_lists','schools',
                       'teacher_attendance_records','class_teachers',
                       'teacher_training_assignments','exam_check_sessions']) {
    eq(isAudited(table), true);
  }
});

t('the excluded tables are still excluded', () => {
  eq(isAudited('chat_sessions'), false);
  eq(isAudited('training_certificates'), false);
});

});
