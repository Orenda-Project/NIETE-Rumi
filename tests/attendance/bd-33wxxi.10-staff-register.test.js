/**
 * bd-33wxxi.10 — the principal's TEACHER register in the app's own Attendance (listId "staff").
 *
 * Principals mark their teachers on WhatsApp every day. In the app, the Attendance tile opened an empty
 * "No classes yet" for a principal. Now, when the portal says the staff register is allowed (the principal
 * app's switch AND role principal — the dashboard decides), attendance-portal.service lists her school's
 * teachers as a register, first, and every read and write on it goes through the code WhatsApp uses:
 *
 *   - WHO: attendance-write's loadStaffRoster (the school's live teachers, never herself);
 *   - the WRITE: attendance-write's markTeachers (one row per teacher per day, marked_by = her, leave
 *     defaults to casual as WhatsApp's), into teacher_attendance_records;
 *   - the MONTH: the register's own staff rule, present ÷ (present + absent), leave excused — so the app's
 *     % is the Excel's %;
 *   - the REGISTER: the same builder and delivery, subject 'teacher', for her school.
 *
 * Nobody else can name "staff": without the caller's say-so, or for a user who is not a principal with a
 * school, it is NOT_FOUND and nothing is read or written. A class teacher's registers are unchanged.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Portal = () => require('../../bot/shared/services/attendance-portal.service');

const PRINCIPAL = 'u-principal';
const SCHOOL = 'school-1';
const STAFF_ROWS = [
  { id: 't1', name: 'Ayesha Sample', phone_number: '920000000001' },
  { id: 't2', name: 'Farah Sample', phone_number: '920000000002' },
  { id: 't3', name: '', phone_number: '920000000003' },
];
const HER_CLASS = { id: 'list-5a', class_name: 'Grade 5', section: 'A', class_id: 'class-5a' };

function deps(over = {}) {
  return {
    regionToday: jest.fn(() => '2026-10-08'),
    dateBounds: jest.fn(() => ({ min_date: '2026-07-10', max_date: '2026-10-08' })),
    ownList: jest.fn(async () => null),
    lists: jest.fn(async () => []),
    rosterCounts: jest.fn(async () => new Map([['list-5a', 32]])),
    classMeta: jest.fn(async () => new Map([['class-5a', { gradeCode: 'grade_5', section: 'A', subjectCodes: ['maths'] }]])),
    sessionsOn: jest.fn(async () => []),
    loadStudentRoster: jest.fn(async () => []),
    markStudents: jest.fn(),
    sessionOn: jest.fn(async () => null),
    recordsFor: jest.fn(async () => []),
    monthSessions: jest.fn(async () => []),
    registerParts: jest.fn(),
    buildRegister: jest.fn(async () => Buffer.from('xlsx-bytes')),
    registerFileName: jest.fn((label, m, y, subject) => `${subject}:${label}:${m}:${y}.xlsx`),
    deliverRegister: jest.fn(async () => ({ delivered: true })),
    // the staff register's I/O
    principalSchool: jest.fn(async (userId) => (userId === PRINCIPAL ? { schoolId: SCHOOL } : null)),
    schoolName: jest.fn(async () => 'GGPS Sample'),
    staffRoster: jest.fn(async () => STAFF_ROWS),
    personName: (p) => (p.name || '').trim() || p.phone_number || 'Unnamed',
    staffDay: jest.fn(async () => []),
    staffMonth: jest.fn(async () => []),
    markTeachers: jest.fn(async () => ({ replaced: false, summary: { total: 3, present: 2, absent: 1, leave: 0 } })),
    staffRegisterParts: jest.fn(async () => ({ people: STAFF_ROWS, label: 'GGPS Sample', records: [] })),
    ...over,
  };
}

beforeEach(() => { jest.resetModules(); });

describe('who can name the staff register', () => {
  test('without the caller\'s say-so there is no staff register, and her users row is never read', async () => {
    const d = deps({ lists: jest.fn(async () => [HER_CLASS]) });
    const out = await Portal().listClasses({ userId: PRINCIPAL }, d);
    expect(out.classes.map((c) => c.listId)).toEqual(['list-5a']);
    expect(d.principalSchool).not.toHaveBeenCalled();
    for (const call of ['roster', 'day', 'month', 'registerFile', 'sendRegister']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await Portal()[call]({ userId: PRINCIPAL, listId: 'staff', date: '2026-10-08', month: '2026-10' }, d)).toEqual({ code: 'NOT_FOUND' });
    }
    expect(await Portal().mark({ userId: PRINCIPAL, listId: 'staff', date: '2026-10-08', absentIds: ['t1'] }, d)).toEqual({ code: 'NOT_FOUND' });
    expect(d.principalSchool).not.toHaveBeenCalled();
    expect(d.staffRoster).not.toHaveBeenCalled();
    expect(d.markTeachers).not.toHaveBeenCalled();
    // "staff" is never sent to the class reads as if it were a class id (student_lists.id is a uuid).
    expect(d.ownList).not.toHaveBeenCalledWith(expect.anything(), 'staff');
  });

  test('a teacher (not a principal with a school) gets NOT_FOUND even when the caller allows it; nothing written', async () => {
    const d = deps({ principalSchool: jest.fn(async () => null) });
    const out = await Portal().listClasses({ userId: 'u-teacher', staff: true }, d);
    expect(out.classes).toEqual([]);
    expect(await Portal().roster({ userId: 'u-teacher', listId: 'staff', staff: true }, d)).toEqual({ code: 'NOT_FOUND' });
    expect(await Portal().mark({ userId: 'u-teacher', listId: 'staff', staff: true, date: '2026-10-08', absentIds: [] }, d))
      .toEqual({ code: 'NOT_FOUND' });
    expect(d.staffRoster).not.toHaveBeenCalled();
    expect(d.markTeachers).not.toHaveBeenCalled();
  });
});

describe('classes: her teachers come first', () => {
  test('a principal with no class: the staff register alone, with its size and that day\'s status', async () => {
    const d = deps();
    const out = await Portal().listClasses({ userId: PRINCIPAL, staff: true }, d);
    expect(d.principalSchool).toHaveBeenCalledWith(PRINCIPAL);
    expect(d.staffRoster).toHaveBeenCalledWith(SCHOOL, PRINCIPAL);
    expect(d.staffDay).toHaveBeenCalledWith(SCHOOL, '2026-10-08');
    expect(out).toEqual({
      date: '2026-10-08',
      classes: [{
        listId: 'staff', label: 'GGPS Sample', gradeCode: null, section: null, subjectCodes: [], students: 3,
        marked: false, present: null, absent: null, leave: null,
      }],
    });
  });

  test('a day already marked (on WhatsApp or here): marked, with the counts from teacher_attendance_records', async () => {
    const d = deps({
      staffDay: jest.fn(async () => [
        { teacher_id: 't1', status: 'present' }, { teacher_id: 't2', status: 'absent' }, { teacher_id: 't3', status: 'leave' },
      ]),
    });
    const [staff] = (await Portal().listClasses({ userId: PRINCIPAL, staff: true }, d)).classes;
    expect(staff).toMatchObject({ listId: 'staff', marked: true, present: 1, absent: 1, leave: 1 });
  });

  test('a principal who also owns a class: teachers first, then her class exactly as a teacher sees it', async () => {
    const d = deps({ lists: jest.fn(async () => [HER_CLASS]) });
    const out = await Portal().listClasses({ userId: PRINCIPAL, staff: true }, d);
    expect(out.classes.map((c) => c.listId)).toEqual(['staff', 'list-5a']);
    expect(out.classes[1]).toEqual({
      listId: 'list-5a', label: 'Grade 5 - A', gradeCode: 'grade_5', section: 'A', subjectCodes: ['maths'], students: 32,
      marked: false, present: null, absent: null, leave: null,
    });
  });
});

describe('roster', () => {
  test('her school\'s teachers, named as WhatsApp names them, no roll numbers', async () => {
    const out = await Portal().roster({ userId: PRINCIPAL, listId: 'staff', staff: true }, deps());
    expect(out).toEqual({
      listId: 'staff', label: 'GGPS Sample',
      students: [
        { id: 't1', name: 'Ayesha Sample', roll: null },
        { id: 't2', name: 'Farah Sample', roll: null },
        { id: 't3', name: '920000000003', roll: null },
      ],
    });
  });
});

describe('mark', () => {
  test('through markTeachers, by exception, for her school, her as the marker, leave type left to WhatsApp\'s default', async () => {
    const d = deps();
    const out = await Portal().mark({
      userId: PRINCIPAL, listId: 'staff', staff: true, date: '2026-10-08', absentIds: ['t2', 'stranger'], leaveIds: ['x'],
    }, d);
    expect(d.markTeachers).toHaveBeenCalledWith({
      principalUserId: PRINCIPAL, schoolId: SCHOOL, date: '2026-10-08', staff: STAFF_ROWS, absentIds: ['t2'], leaveIds: [],
    });
    expect(out).toEqual({ date: '2026-10-08', present: 2, absent: 1, leave: 0, replaced: false });
  });

  test('outside WhatsApp\'s window is BAD_DATE; a school with no teachers is EMPTY_ROSTER; nothing written', async () => {
    const d = deps();
    expect(await Portal().mark({ userId: PRINCIPAL, listId: 'staff', staff: true, date: '2026-10-09', absentIds: [] }, d))
      .toEqual({ code: 'BAD_DATE' });
    const empty = deps({ staffRoster: jest.fn(async () => []) });
    expect(await Portal().mark({ userId: PRINCIPAL, listId: 'staff', staff: true, date: '2026-10-08', absentIds: [] }, empty))
      .toEqual({ code: 'EMPTY_ROSTER' });
    expect(d.markTeachers).not.toHaveBeenCalled();
    expect(empty.markTeachers).not.toHaveBeenCalled();
  });
});

describe('day', () => {
  test('a day nobody marked, and a marked day with each teacher\'s status', async () => {
    let out = await Portal().day({ userId: PRINCIPAL, listId: 'staff', staff: true, date: '2026-10-07' }, deps());
    expect(out).toEqual({ date: '2026-10-07', marked: false, present: null, absent: null, leave: null, statuses: {} });
    const d = deps({ staffDay: jest.fn(async () => [{ teacher_id: 't1', status: 'present' }, { teacher_id: 't3', status: 'leave' }]) });
    out = await Portal().day({ userId: PRINCIPAL, listId: 'staff', staff: true, date: '2026-10-06' }, d);
    expect(d.staffDay).toHaveBeenCalledWith(SCHOOL, '2026-10-06');
    expect(out).toEqual({ date: '2026-10-06', marked: true, present: 1, absent: 0, leave: 1, statuses: { t1: 'present', t3: 'leave' } });
  });
});

describe('month: the register\'s staff rule (leave is excused)', () => {
  test('each day\'s counts, and each teacher\'s present ÷ (present + absent), lowest first', async () => {
    const records = [
      { teacher_id: 't1', date: '2026-10-01', status: 'present' },
      { teacher_id: 't2', date: '2026-10-01', status: 'absent' },
      { teacher_id: 't3', date: '2026-10-01', status: 'leave' },
      { teacher_id: 't1', date: '2026-10-02', status: 'present' },
      { teacher_id: 't2', date: '2026-10-02', status: 'present' },
      { teacher_id: 't3', date: '2026-10-02', status: 'leave' },
    ];
    const d = deps({ staffMonth: jest.fn(async () => records) });
    const out = await Portal().month({ userId: PRINCIPAL, listId: 'staff', staff: true, month: '2026-10' }, d);
    expect(d.staffMonth).toHaveBeenCalledWith(SCHOOL, '2026-10-01', '2026-10-31');
    expect(out.days).toEqual([
      // total = the day's denominator under the staff rule: present + absent (leave excused)
      { date: '2026-10-01', present: 1, absent: 1, leave: 1, total: 2 },
      { date: '2026-10-02', present: 2, absent: 0, leave: 1, total: 2 },
    ]);
    expect(out.students).toEqual([
      { id: 't2', name: 'Farah Sample', roll: null, present: 1, marked: 2, pct: 50 },
      { id: 't1', name: 'Ayesha Sample', roll: null, present: 2, marked: 2, pct: 100 },
      // only leave: no present or absent day, so no percentage (never a black mark)
      { id: 't3', name: '920000000003', roll: null, present: 0, marked: 0, pct: null },
    ]);
  });
});

describe('register', () => {
  test('the Excel file: the staff register WhatsApp sends, for her school and that month', async () => {
    const d = deps();
    const out = await Portal().registerFile({ userId: PRINCIPAL, listId: 'staff', staff: true, month: '2026-10' }, d);
    expect(d.staffRegisterParts).toHaveBeenCalledWith(SCHOOL, PRINCIPAL, expect.objectContaining({ month: 10, year: 2026 }));
    expect(d.buildRegister).toHaveBeenCalledWith({ title: 'GGPS Sample', subject: 'teacher' }, 10, 2026, STAFF_ROWS, []);
    expect(out).toEqual({ fileName: 'teacher:GGPS Sample:10:2026.xlsx', base64: Buffer.from('xlsx-bytes').toString('base64') });
  });

  test('send to WhatsApp: the existing delivery, subject teacher, target her school; this month runs up to today', async () => {
    const d = deps();
    expect(await Portal().sendRegister({ userId: PRINCIPAL, listId: 'staff', staff: true, month: '2026-10' }, d)).toEqual({ delivered: true });
    expect(d.deliverRegister).toHaveBeenCalledWith({ userId: PRINCIPAL, subject: 'teacher', targetId: SCHOOL, date: '2026-10-08' });
  });

  test('a class register is still the student register', async () => {
    const LIST = { id: 'list-5a', class_name: 'Grade 5', section: 'A', class_id: 'class-5a' };
    const d = deps({
      ownList: jest.fn(async () => LIST),
      registerParts: jest.fn(async () => ({ people: [], label: 'Grade 5 - A', records: [] })),
    });
    const out = await Portal().registerFile({ userId: PRINCIPAL, listId: 'list-5a', staff: true, month: '2026-10' }, d);
    expect(d.buildRegister).toHaveBeenCalledWith({ title: 'Grade 5 - A', subject: 'student' }, 10, 2026, [], []);
    expect(out.fileName).toBe('student:Grade 5 - A:10:2026.xlsx');
    expect(d.principalSchool).not.toHaveBeenCalled();
  });
});

/*
 * End to end, on the in-memory database (tests/fixtures/fake-supabase.js applies the filters): the app's
 * production I/O (defaultDeps) and WhatsApp's own reads agree about a day and a month.
 */
describe('end to end: the app and WhatsApp write and read the same rows', () => {
  const { createFakeSupabase } = require('../fixtures/fake-supabase');
  let db;

  function seed() {
    return createFakeSupabase({
      users: [
        { id: PRINCIPAL, role: 'principal', school_id: SCHOOL, name: 'Saima Principal', phone_number: '920000000009', deleted_at: null },
        { id: 't1', role: 'teacher', school_id: SCHOOL, name: 'Ayesha Sample', phone_number: '920000000001', deleted_at: null },
        { id: 't2', role: 'teacher', school_id: SCHOOL, name: 'Farah Sample', phone_number: '920000000002', deleted_at: null },
        { id: 't3', role: 'teacher', school_id: SCHOOL, name: 'Hina Sample', phone_number: '920000000003', deleted_at: null },
        { id: 't-retired', role: 'teacher', school_id: SCHOOL, name: 'Hina Sample', phone_number: 'merged:t3', deleted_at: '2026-09-01' },
        { id: 't-elsewhere', role: 'teacher', school_id: 'school-2', name: 'Other School', phone_number: '920000000004', deleted_at: null },
      ],
      schools: [{ id: SCHOOL, name: 'GGPS Sample' }],
      student_lists: [],
      // A day she marked on WhatsApp earlier in the month.
      teacher_attendance_records: [
        { teacher_id: 't1', school_id: SCHOOL, date: '2026-10-06', status: 'present', leave_type: null, marked_by_user_id: PRINCIPAL },
        { teacher_id: 't2', school_id: SCHOOL, date: '2026-10-06', status: 'absent', leave_type: null, marked_by_user_id: PRINCIPAL },
        { teacher_id: 't3', school_id: SCHOOL, date: '2026-10-06', status: 'leave', leave_type: 'casual', marked_by_user_id: PRINCIPAL },
      ],
    });
  }

  function load() {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: (...a) => db.from(...a), rpc: (...a) => db.rpc(...a) }));
    const P = require('../../bot/shared/services/attendance-portal.service');
    const real = P.defaultDeps();
    const d = { ...real, regionToday: () => '2026-10-08', dateBounds: () => ({ min_date: '2026-07-10', max_date: '2026-10-08' }) };
    return { P, d };
  }

  beforeEach(() => { db = seed(); });

  test('the staff register lists her live teachers, never herself, a retired copy or another school\'s', async () => {
    const { P, d } = load();
    const out = await P.listClasses({ userId: PRINCIPAL, staff: true }, d);
    expect(out.classes).toEqual([expect.objectContaining({ listId: 'staff', label: 'GGPS Sample', students: 3, marked: false })]);
    const roster = await P.roster({ userId: PRINCIPAL, listId: 'staff', staff: true }, d);
    expect(roster.students.map((s) => s.id).sort()).toEqual(['t1', 't2', 't3']);
  });

  test('a mark writes one row per teacher, her as marker, at her school — and WhatsApp\'s reads see the day', async () => {
    const { P, d } = load();
    const out = await P.mark({ userId: PRINCIPAL, listId: 'staff', staff: true, date: '2026-10-08', absentIds: ['t2', 't-elsewhere'], leaveIds: ['t3'] }, d);
    expect(out).toEqual({ date: '2026-10-08', present: 1, absent: 1, leave: 1, replaced: false });

    const rows = (await db.from('teacher_attendance_records').select('*').eq('date', '2026-10-08')).data;
    expect(rows.map((r) => [r.teacher_id, r.status, r.leave_type, r.school_id, r.marked_by_user_id]).sort()).toEqual([
      ['t1', 'present', null, SCHOOL, PRINCIPAL],
      ['t2', 'absent', null, SCHOOL, PRINCIPAL],
      ['t3', 'leave', 'casual', SCHOOL, PRINCIPAL],
    ]);

    // WhatsApp's "already marked" read (attendance-marking-endpoint existingRegister) asks exactly this:
    const seen = (await db.from('teacher_attendance_records').select('teacher_id, status, date')
      .eq('school_id', SCHOOL).eq('date', '2026-10-08')).data;
    expect(seen).toHaveLength(3);
    // ...and the register WhatsApp sends reads the day through its own loader.
    const Delivery = require('../../bot/shared/services/attendance-register-delivery.service');
    const month = await Delivery.loadMonthRecords('teacher', SCHOOL, { start: '2026-10-01', end: '2026-10-31' });
    expect(month.filter((r) => r.date === '2026-10-08')).toHaveLength(3);

    // The app now shows the day marked, in the selector and in the day view.
    const classes = await P.listClasses({ userId: PRINCIPAL, staff: true }, d);
    expect(classes.classes[0]).toMatchObject({ marked: true, present: 1, absent: 1, leave: 1 });
    const day = await P.day({ userId: PRINCIPAL, listId: 'staff', staff: true, date: '2026-10-08' }, d);
    expect(day).toEqual({ date: '2026-10-08', marked: true, present: 1, absent: 1, leave: 1, statuses: { t1: 'present', t2: 'absent', t3: 'leave' } });
  });

  test('a day marked on WhatsApp opens marked in the app; re-marking it in the app replaces it', async () => {
    const { P, d } = load();
    const day = await P.day({ userId: PRINCIPAL, listId: 'staff', staff: true, date: '2026-10-06' }, d);
    expect(day.statuses).toEqual({ t1: 'present', t2: 'absent', t3: 'leave' });
    const out = await P.mark({ userId: PRINCIPAL, listId: 'staff', staff: true, date: '2026-10-06', absentIds: [], leaveIds: [] }, d);
    expect(out).toMatchObject({ present: 3, absent: 0, leave: 0, replaced: true });
    const rows = (await db.from('teacher_attendance_records').select('*').eq('date', '2026-10-06')).data;
    expect(rows.map((r) => r.status)).toEqual(['present', 'present', 'present']);
  });

  test('the month view\'s % for each teacher is the % in the Excel register', async () => {
    const { P, d } = load();
    await P.mark({ userId: PRINCIPAL, listId: 'staff', staff: true, date: '2026-10-07', absentIds: ['t1'], leaveIds: [] }, d);
    await P.mark({ userId: PRINCIPAL, listId: 'staff', staff: true, date: '2026-10-08', absentIds: [], leaveIds: ['t2'] }, d);

    const month = await P.month({ userId: PRINCIPAL, listId: 'staff', staff: true, month: '2026-10' }, d);
    const file = await P.registerFile({ userId: PRINCIPAL, listId: 'staff', staff: true, month: '2026-10' }, d);
    expect(file.fileName).toBe('Teacher_Attendance_GGPS_Sample_October_2026.xlsx');

    // The root suite maps exceljs to its recording stub (tests/__mocks__/exceljs.js): the "file" is the
    // sheets' rows as JSON, written by the register's own builder. Staff rows: [name, day 1..31, P, A, L, %].
    const sheets = JSON.parse(Buffer.from(file.base64, 'base64').toString('utf8'));
    const sheet = sheets.find((s) => s.name === 'Teacher Register');
    const excel = {};
    // Five header rows: title, School, Month, the day numbers, the weekday names.
    sheet.rows.slice(5).forEach((values) => { excel[values[0]] = values[values.length - 1]; });

    expect(Object.keys(excel).sort()).toEqual(['Ayesha Sample', 'Farah Sample', 'Hina Sample']);
    for (const s of month.students) {
      if (s.pct === null) continue;
      expect(`${s.pct}%`).toBe(excel[s.name]);
    }
    // t1: P 06, A 07, P 08 → 2 of 3 = 67%; t2: A 06, P 07, L 08 → 1 of 2 = 50%; t3: L 06, P 07, P 08 → 100%.
    expect(Object.fromEntries(month.students.map((s) => [s.id, s.pct]))).toEqual({ t1: 67, t2: 50, t3: 100 });
  });
});

/*
 * The internal route (bot/shared/routes/internal-attendance.routes.js) passes the portal's say-so through, and
 * only a literal true counts.
 */
describe('internal route: staff is passed through only when it is literally true', () => {
  async function call(path, body) {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    const seen = {};
    const fake = new Proxy({}, { get: (_t, name) => async (args) => { seen[name] = args; return { ok: true }; } });
    jest.doMock('../../bot/shared/services/attendance-portal.service', () => fake);
    process.env.INTERNAL_API_KEY = 'k';
    const router = require('../../bot/shared/routes/internal-attendance.routes');
    const layer = router.stack.find((l) => l.route && l.route.path === path);
    const req = { body, headers: { 'x-api-key': 'k' }, path };
    let status = 200; let payload = null;
    const res = { status(c) { status = c; return this; }, json(b) { payload = b; return this; } };
    for (const s of layer.route.stack) {
      let go = false;
      // eslint-disable-next-line no-await-in-loop
      await s.handle(req, res, () => { go = true; });
      if (!go) break;
    }
    return { status, payload, seen };
  }

  test.each([
    ['/attendance/classes', 'listClasses', { userId: PRINCIPAL }],
    ['/attendance/roster', 'roster', { userId: PRINCIPAL, listId: 'staff' }],
    ['/attendance/mark', 'mark', { userId: PRINCIPAL, listId: 'staff', date: '2026-10-08', absentIds: [], leaveIds: [] }],
    ['/attendance/day', 'day', { userId: PRINCIPAL, listId: 'staff', date: '2026-10-08' }],
    ['/attendance/month', 'month', { userId: PRINCIPAL, listId: 'staff', month: '2026-10' }],
    ['/attendance/register', 'registerFile', { userId: PRINCIPAL, listId: 'staff', month: '2026-10' }],
    ['/attendance/register/send', 'sendRegister', { userId: PRINCIPAL, listId: 'staff', month: '2026-10' }],
  ])('%s', async (path, fn, body) => {
    let r = await call(path, { ...body, staff: true });
    expect(r.status).toBe(200);
    expect(r.seen[fn]).toMatchObject({ userId: PRINCIPAL, staff: true });
    r = await call(path, { ...body, staff: 'true' });
    expect(r.seen[fn].staff).toBe(false);
    r = await call(path, body);
    expect(r.seen[fn].staff).toBe(false);
  });
});
