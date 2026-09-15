'use strict';
/**
 * bd-rbtpr — the two ledger gaps left after bd-a21ks.
 *
 * 1. WHO. /class (class-manager-endpoint) and "edit class" (edit-class-endpoint)
 *    were not wrapped in runAsActor, so every row they wrote reached record_history
 *    as the connection role 'authenticator'. /roster and /observe-visit were.
 * 2. WHAT. A hand-over (roster_hand_over_class) repoints each enrolled child's
 *    students.list_id onto the new class teacher's attendance list. students_history_trigger
 *    did not watch list_id (live definition identical on sandbox, staging and prod,
 *    15 Sep 2026), so that move was only inferable from the txid.
 *
 * Only the database boundary is faked. The real exported endpoint functions, the
 * real ClassService and the real actor context run; the fake records the acting
 * user at the moment each write EXECUTES (the builder's then — when the fetch fires).
 */
const fs = require('fs');
const path = require('path');
const { createFakeSupabase } = require('../fixtures/fake-supabase');

const TEACHER = 'b1c2d3e4-0000-4000-8000-0000000c1a55';
const SCHOOL = 'b1c2d3e4-0000-4000-8000-00000005c001';
const CLASS_ID = 'b1c2d3e4-0000-4000-8000-0000000c1a00';
const LIST_ID = 'b1c2d3e4-0000-4000-8000-00000000115e';

let mockDb;
let mockWrites;
jest.mock('../../bot/shared/config/supabase', () => {
  const WRITE_OPS = ['insert', 'update', 'upsert', 'delete'];
  const wrap = (table, b) => {
    let op = null;
    const proxy = new Proxy(b, {
      get(target, prop) {
        if (prop === 'then') {
          return (res, rej) => {
            if (op) {
              // eslint-disable-next-line global-require
              const { currentActor } = require('../../bot/shared/utils/actor-context');
              mockWrites.push({ table, op, actor: currentActor() });
            }
            return target.then(res, rej);
          };
        }
        const v = target[prop];
        if (typeof v !== 'function') return v;
        return (...args) => {
          if (WRITE_OPS.includes(prop)) op = prop;
          if ((prop === 'single' || prop === 'maybeSingle') && op) {
            // single()/maybeSingle() execute the query themselves, not via then.
            // eslint-disable-next-line global-require
            const { currentActor } = require('../../bot/shared/utils/actor-context');
            mockWrites.push({ table, op, actor: currentActor() });
          }
          const out = v.apply(target, args);
          return out === target ? proxy : out;
        };
      },
    });
    return proxy;
  };
  return {
    from: (t) => wrap(t, mockDb.from(t)),
    rpc: (...a) => mockDb.rpc(...a),
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

function seed() {
  return {
    users: [{ id: TEACHER, school_id: SCHOOL, preferred_language: 'en', role: 'teacher' }],
    grade_levels: [{ code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4'], sort_order: 4, is_active: true }],
    subjects: [{ code: 'maths', parent_code: null, aliases: ['maths'], is_active: true }],
    sections: [{ code: 'A', sort_order: 1, is_active: true }],
    shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
    academic_sessions: [
      { code: '2026-2027', kind: 'annual', starts_on: '2026-04-01', ends_on: '2027-03-31', is_active: true },
    ],
    classes: [{ id: CLASS_ID, school_id: SCHOOL, grade_code: 'grade_4', section: 'A', shift_code: 'morning', session_code: '2026-2027', is_active: true }],
    class_teachers: [{ id: 'ct-1', class_id: CLASS_ID, teacher_user_id: TEACHER, is_class_teacher: true, is_active: true }],
    class_teacher_subjects: [],
    class_enrollments: [{ id: 'ce-1', class_id: CLASS_ID, student_id: 'kid-1', roll_number: 1, is_active: true }],
    student_lists: [{ id: LIST_ID, user_id: TEACHER, class_name: 'Grade 4', section: 'A', class_id: CLASS_ID, is_active: true, student_count: 1, academic_year: '2026-2027' }],
    students: [{ id: 'kid-1', student_name: 'Child One', roll_number: 1, list_id: LIST_ID, is_active: true }],
  };
}

beforeEach(() => {
  jest.resetModules();
  mockWrites = [];
  mockDb = createFakeSupabase(seed());
});

const actorsOf = (writes) => [...new Set(writes.map((w) => w.actor))];

// ── 1. /class writes name the teacher ─────────────────────────────────────────

describe('/class (class-manager) runs its writes as the flow-token user', () => {
  it('creating a class: classes, class_teachers and the attendance mirror all carry the actor', async () => {
    const ep = require('../../bot/shared/routes/class-manager-endpoint');
    // A fresh grade/section so createClass really inserts.
    mockDb._tables.classes.length = 0;
    mockDb._tables.class_teachers.length = 0;
    mockDb._tables.student_lists.length = 0;
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'A', shift: 'morning' });
    await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', { subjects: ['maths'], is_class_teacher: true });

    const tables = mockWrites.map((w) => w.table);
    expect(tables).toEqual(expect.arrayContaining(['classes', 'class_teachers', 'student_lists']));
    expect(actorsOf(mockWrites)).toEqual([TEACHER]);
  });

  it('saving the roster (add + remove): students, enrolments and the removal carry the actor', async () => {
    const ep = require('../../bot/shared/routes/class-manager-endpoint');
    await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { remove: ['kid-1'], add: 'Child Two' });
    expect(res.screen).toBe('SAVED');

    const tables = mockWrites.map((w) => w.table);
    expect(tables).toEqual(expect.arrayContaining(['class_enrollments', 'students']));
    expect(mockWrites.length).toBeGreaterThanOrEqual(3);
    expect(actorsOf(mockWrites)).toEqual([TEACHER]);
  });

  it('INIT and BACK run inside the context too (nothing they call can write as nobody)', async () => {
    const ep = require('../../bot/shared/routes/class-manager-endpoint');
    const { currentActor } = require('../../bot/shared/utils/actor-context');
    let seen = 'unset';
    const orig = mockDb.from;
    mockDb.from = (t) => { if (t === 'users' && seen === 'unset') seen = currentActor(); return orig(t); };
    await ep.handleClassesInit(TEACHER);
    expect(seen).toBe(TEACHER);
    seen = 'unset';
    await ep.handleClassManagerBack(TEACHER, 'SUBJECTS');
    expect(seen).toBe(TEACHER);
  });
});

// ── 2. edit class writes name the user in the token ───────────────────────────

describe('edit class runs its writes as the user in "<userId>:<listId>"', () => {
  const token = `${TEACHER}:${LIST_ID}`;

  it('ADD: the students insert, the enrolment and the count sync carry the actor', async () => {
    const ep = require('../../bot/shared/routes/edit-class-endpoint');
    const res = await ep.handleEditClassDataExchange(token, 'ADD', { roster: 'Child Three' });
    expect(res.screen).toBe('SAVED');
    expect(mockWrites.map((w) => w.table)).toEqual(expect.arrayContaining(['students', 'class_enrollments', 'student_lists']));
    expect(actorsOf(mockWrites)).toEqual([TEACHER]);
  });

  it('REMOVE and RENAME carry the actor', async () => {
    const ep = require('../../bot/shared/routes/edit-class-endpoint');
    await ep.handleEditClassDataExchange(token, 'RENAME', { student_id: 'kid-1', new_name: 'Child One Fixed' });
    await ep.handleEditClassDataExchange(token, 'REMOVE', { remove_ids: ['kid-1'] });
    expect(mockWrites.filter((w) => w.table === 'students').length).toBe(2);
    expect(actorsOf(mockWrites)).toEqual([TEACHER]);
  });

  it('INIT runs inside the context', async () => {
    const ep = require('../../bot/shared/routes/edit-class-endpoint');
    const { currentActor } = require('../../bot/shared/utils/actor-context');
    let seen = 'unset';
    const orig = mockDb.from;
    mockDb.from = (t) => { if (seen === 'unset') seen = currentActor(); return orig(t); };
    await ep.handleEditClassInit(token);
    expect(seen).toBe(TEACHER);
  });

  it('a token whose user part is not a uuid names nobody — and the write still happens', async () => {
    const ep = require('../../bot/shared/routes/edit-class-endpoint');
    const res = await ep.handleEditClassDataExchange(`923001234567:${LIST_ID}`, 'RENAME', { student_id: 'kid-1', new_name: 'Renamed' });
    expect(res.data.heading).toBe('Name updated');
    expect(mockWrites).toHaveLength(1);
    expect(mockWrites[0].actor).toBeNull();
  });

  it('parseToken is still exported unchanged', () => {
    const { parseToken } = require('../../bot/shared/routes/edit-class-endpoint');
    expect(parseToken(token)).toEqual({ userId: TEACHER, listId: LIST_ID });
  });
});

// ── 3. nothing outside a request is attributed ────────────────────────────────

describe('writes outside a coach/teacher request are unchanged', () => {
  it('a write after the handler returns carries no actor', async () => {
    const ep = require('../../bot/shared/routes/edit-class-endpoint');
    const supabase = require('../../bot/shared/config/supabase');
    await ep.handleEditClassDataExchange(`${TEACHER}:${LIST_ID}`, 'RENAME', { student_id: 'kid-1', new_name: 'X' });
    mockWrites.length = 0;
    await supabase.from('users').update({ name: 'Unrelated' }).eq('id', TEACHER);
    expect(mockWrites).toEqual([{ table: 'users', op: 'update', actor: null }]);
  });
});

// ── 4. the hand-over's list_id move is a ledger row ───────────────────────────

describe('students.list_id is watched', () => {
  const { WATCHED, diffWatched } = require('../../scripts/row-history-audit');
  const dir = path.join(__dirname, '..', '..', 'bot', 'database', 'migrations');

  it('the JS mirror watches list_id', () => {
    expect(WATCHED.students).toContain('list_id');
  });

  it('a hand-over repointing a child records list_id old -> new', () => {
    const d = diffWatched('students', { id: 'kid-1', list_id: 'coach-list', student_name: 'A' },
      { id: 'kid-1', list_id: 'teacher-list', student_name: 'A' });
    expect(d.changed_cols).toEqual(['list_id']);
    expect(d.old_vals.list_id).toBe('coach-list');
    expect(d.new_vals.list_id).toBe('teacher-list');
  });

  /** The last CREATE TRIGGER students_history_trigger across the legacy migrations wins. */
  function effectiveStudentsTrigger() {
    let last = null;
    for (const n of fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && !/rollback/i.test(f)).sort()) {
      const sql = fs.readFileSync(path.join(dir, n), 'utf8').replace(/--[^\n]*/g, '');
      const re = /CREATE\s+TRIGGER\s+students_history_trigger[\s\S]*?log_row_changes\(([\s\S]*?)\)\s*;/gi;
      let m;
      while ((m = re.exec(sql))) last = { file: n, args: m[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1)) };
    }
    return last;
  }

  it('the trigger the migrations leave behind watches exactly the JS mirror, list_id included', () => {
    const t = effectiveStudentsTrigger();
    expect(t.file).toBe('students_history_list_id.sql');
    expect(t.args[0]).toBe('id');
    expect(t.args.slice(1)).toEqual(WATCHED.students);
  });

  it('the migration is re-runnable and has a DOWN that restores the previous eight columns', () => {
    const up = fs.readFileSync(path.join(dir, 'students_history_list_id.sql'), 'utf8');
    expect(up).toMatch(/DROP TRIGGER IF EXISTS students_history_trigger ON public\.students/);
    const downPath = path.join(dir, 'students_history_list_id_rollback.sql');
    expect(fs.existsSync(downPath)).toBe(true);
    const down = fs.readFileSync(downPath, 'utf8').replace(/--[^\n]*/g, '');
    const args = down.match(/log_row_changes\(([\s\S]*?)\)\s*;/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
    expect(args).toEqual(['id', 'student_name', 'father_name', 'roll_number', 'is_active', 'status',
      'school_id', 'merged_into', 'admission_no']);
  });
});
