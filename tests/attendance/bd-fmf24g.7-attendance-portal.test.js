/**
 * bd-fmf24g.7 — class attendance for the teacher portal (v2), on the bot's side.
 *
 * The portal reaches these over the internal API, the way it reaches the LP catalogue and the
 * assessment editor: the bot owns the roster rule, the write path and the register, so the
 * portal and WhatsApp cannot disagree about a day.
 *
 * What the tests hold it to:
 *   - every read and write is for a class SHE owns (student_lists.user_id) — anything else is
 *     NOT_FOUND and nothing is read or written;
 *   - marking goes through attendance-write's markStudents (mark by exception, re-mark replaces),
 *     with WhatsApp's date window: the region's today back 90 days, never the future;
 *   - only children on the roster can be marked absent or on leave;
 *   - the day's status per class comes from attendance_sessions (marked or not, with counts);
 *   - a month gives each day's counts and each child's present ÷ days marked — leave is not
 *     present, as on the register;
 *   - the Excel register is the same builder WhatsApp sends.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Portal = () => require('../../bot/shared/services/attendance-portal.service');

const TEACHER = 'u-teacher';
const LIST = 'list-4a';
const LIST_ROW = { id: LIST, class_name: 'Grade 4', section: 'A', class_id: 'class-4a' };
const ROSTER = [
  { id: 's1', student_name: 'Ali Raza', roll_number: 1 },
  { id: 's2', student_name: 'Amna Khalid', roll_number: 2 },
  { id: 's3', student_name: 'Bilal Ahmed', roll_number: 3 },
];

function deps(over = {}) {
  return {
    regionToday: jest.fn(() => '2026-10-08'),
    dateBounds: jest.fn(() => ({ min_date: '2026-07-10', max_date: '2026-10-08' })),
    ownList: jest.fn(async (userId, listId) => (userId === TEACHER && listId === LIST ? LIST_ROW : null)),
    lists: jest.fn(async () => [LIST_ROW, { id: 'list-5b', class_name: 'Grade 5', section: 'B', class_id: 'class-5b' }]),
    rosterCounts: jest.fn(async () => new Map([[LIST, 32], ['list-5b', 28]])),
    classMeta: jest.fn(async () => new Map([
      ['class-4a', { gradeCode: 'grade_4', section: 'A', subjectCodes: ['science'] }],
      ['class-5b', { gradeCode: 'grade_5', section: 'B', subjectCodes: ['maths'] }],
    ])),
    sessionsOn: jest.fn(async () => [{ id: 'sess-5b', list_id: 'list-5b', present_count: 26, absent_count: 2, leave_count: 0 }]),
    loadStudentRoster: jest.fn(async () => ROSTER),
    markStudents: jest.fn(async () => ({ sessionId: 'sess-1', replaced: false, summary: { present: 2, absent: 1, leave: 0 } })),
    sessionOn: jest.fn(async () => null),
    recordsFor: jest.fn(async () => []),
    monthSessions: jest.fn(async () => []),
    registerParts: jest.fn(async () => ({ people: ROSTER, label: 'Grade 4 - A', records: [] })),
    buildRegister: jest.fn(async () => Buffer.from('xlsx-bytes')),
    registerFileName: jest.fn(() => 'Grade 4 - A, October 2026.xlsx'),
    deliverRegister: jest.fn(async () => ({ delivered: true, fileName: 'Grade 4 - A, October 2026.xlsx' })),
    ...over,
  };
}

beforeEach(() => { jest.resetModules(); });

describe('classes (the selector)', () => {
  test('her classes with roster size, grade, section, subjects and that day\'s status', async () => {
    const d = deps();
    const out = await Portal().listClasses({ userId: TEACHER }, d);
    expect(d.lists).toHaveBeenCalledWith(TEACHER);
    expect(d.sessionsOn).toHaveBeenCalledWith([LIST, 'list-5b'], '2026-10-08');
    expect(out.date).toBe('2026-10-08');
    expect(out.classes).toEqual([
      { listId: LIST, label: 'Grade 4 - A', gradeCode: 'grade_4', section: 'A', subjectCodes: ['science'], students: 32,
        marked: false, present: null, absent: null, leave: null },
      { listId: 'list-5b', label: 'Grade 5 - B', gradeCode: 'grade_5', section: 'B', subjectCodes: ['maths'], students: 28,
        marked: true, present: 26, absent: 2, leave: 0 },
    ]);
  });

  test('a date outside the marking window is BAD_DATE and nothing is read', async () => {
    const d = deps();
    expect(await Portal().listClasses({ userId: TEACHER, date: '2026-10-09' }, d)).toEqual({ code: 'BAD_DATE' });
    expect(await Portal().listClasses({ userId: TEACHER, date: '2026-07-09' }, d)).toEqual({ code: 'BAD_DATE' });
    expect(d.lists).not.toHaveBeenCalled();
  });
});

describe('roster', () => {
  test('her class: children in roll order', async () => {
    const out = await Portal().roster({ userId: TEACHER, listId: LIST }, deps());
    expect(out).toEqual({
      listId: LIST, label: 'Grade 4 - A',
      students: [{ id: 's1', name: 'Ali Raza', roll: 1 }, { id: 's2', name: 'Amna Khalid', roll: 2 }, { id: 's3', name: 'Bilal Ahmed', roll: 3 }],
    });
  });

  test('someone else\'s class is NOT_FOUND and the roster is never read', async () => {
    const d = deps();
    expect(await Portal().roster({ userId: 'u-other', listId: LIST }, d)).toEqual({ code: 'NOT_FOUND' });
    expect(d.loadStudentRoster).not.toHaveBeenCalled();
  });
});

describe('mark', () => {
  test('marks through markStudents, by exception, for her class', async () => {
    const d = deps();
    const out = await Portal().mark({ userId: TEACHER, listId: LIST, date: '2026-10-08', absentIds: ['s2'], leaveIds: [] }, d);
    expect(d.markStudents).toHaveBeenCalledWith({
      userId: TEACHER, listId: LIST, date: '2026-10-08', roster: ROSTER, absentIds: ['s2'], leaveIds: [],
    });
    expect(out).toEqual({ date: '2026-10-08', present: 2, absent: 1, leave: 0, replaced: false });
  });

  test('re-marking a day says it replaced the earlier one', async () => {
    const d = deps({ markStudents: jest.fn(async () => ({ replaced: true, summary: { present: 3, absent: 0, leave: 0 } })) });
    const out = await Portal().mark({ userId: TEACHER, listId: LIST, date: '2026-10-06', absentIds: [], leaveIds: [] }, d);
    expect(out.replaced).toBe(true);
  });

  test('children not on the roster are dropped before the write', async () => {
    const d = deps();
    await Portal().mark({ userId: TEACHER, listId: LIST, date: '2026-10-08', absentIds: ['s1', 'stranger'], leaveIds: ['s3', 'x'] }, d);
    const arg = d.markStudents.mock.calls[0][0];
    expect(arg.absentIds).toEqual(['s1']);
    expect(arg.leaveIds).toEqual(['s3']);
  });

  test.each(['2026-10-09', '2026-07-09', 'yesterday', '2026-02-30', null])('date %p is BAD_DATE, nothing written', async (date) => {
    const d = deps();
    expect(await Portal().mark({ userId: TEACHER, listId: LIST, date, absentIds: [], leaveIds: [] }, d)).toEqual({ code: 'BAD_DATE' });
    expect(d.markStudents).not.toHaveBeenCalled();
  });

  test('someone else\'s class is NOT_FOUND, nothing written', async () => {
    const d = deps();
    expect(await Portal().mark({ userId: 'u-other', listId: LIST, date: '2026-10-08' }, d)).toEqual({ code: 'NOT_FOUND' });
    expect(d.markStudents).not.toHaveBeenCalled();
  });

  test('an empty class is EMPTY_ROSTER, nothing written', async () => {
    const d = deps({ loadStudentRoster: jest.fn(async () => []) });
    expect(await Portal().mark({ userId: TEACHER, listId: LIST, date: '2026-10-08' }, d)).toEqual({ code: 'EMPTY_ROSTER' });
    expect(d.markStudents).not.toHaveBeenCalled();
  });
});

describe('day', () => {
  test('a day nobody marked', async () => {
    const out = await Portal().day({ userId: TEACHER, listId: LIST, date: '2026-10-07' }, deps());
    expect(out).toEqual({ date: '2026-10-07', marked: false, present: null, absent: null, leave: null, statuses: {} });
  });

  test('a marked day: the counts and every child\'s status', async () => {
    const d = deps({
      sessionOn: jest.fn(async () => ({ id: 'sess-6', present_count: 1, absent_count: 1, leave_count: 1 })),
      recordsFor: jest.fn(async () => [
        { student_id: 's1', status: 'present' }, { student_id: 's2', status: 'absent' }, { student_id: 's3', status: 'leave' },
      ]),
    });
    const out = await Portal().day({ userId: TEACHER, listId: LIST, date: '2026-10-06' }, d);
    expect(d.sessionOn).toHaveBeenCalledWith(LIST, '2026-10-06');
    expect(d.recordsFor).toHaveBeenCalledWith('sess-6');
    expect(out).toEqual({
      date: '2026-10-06', marked: true, present: 1, absent: 1, leave: 1,
      statuses: { s1: 'present', s2: 'absent', s3: 'leave' },
    });
  });

  test('someone else\'s class is NOT_FOUND', async () => {
    const d = deps();
    expect(await Portal().day({ userId: 'u-other', listId: LIST, date: '2026-10-06' }, d)).toEqual({ code: 'NOT_FOUND' });
    expect(d.sessionOn).not.toHaveBeenCalled();
  });
});

describe('month', () => {
  const SESSIONS = [
    { session_date: '2026-10-02', records: [
      { student_id: 's1', status: 'present' }, { student_id: 's2', status: 'absent' }, { student_id: 's3', status: 'present' }] },
    { session_date: '2026-10-01', records: [
      { student_id: 's1', status: 'present' }, { student_id: 's2', status: 'leave' }, { student_id: 's3', status: 'present' }] },
  ];

  test('each day\'s counts (oldest first) and each child\'s present ÷ days marked, lowest first; leave is not present', async () => {
    const d = deps({ monthSessions: jest.fn(async () => SESSIONS) });
    const out = await Portal().month({ userId: TEACHER, listId: LIST, month: '2026-10' }, d);
    expect(d.monthSessions).toHaveBeenCalledWith(LIST, '2026-10-01', '2026-10-31');
    expect(out.month).toBe('2026-10');
    expect(out.days).toEqual([
      { date: '2026-10-01', present: 2, absent: 0, leave: 1, total: 3 },
      { date: '2026-10-02', present: 2, absent: 1, leave: 0, total: 3 },
    ]);
    expect(out.students).toEqual([
      { id: 's2', name: 'Amna Khalid', roll: 2, present: 0, marked: 2, pct: 0 },
      { id: 's1', name: 'Ali Raza', roll: 1, present: 2, marked: 2, pct: 100 },
      { id: 's3', name: 'Bilal Ahmed', roll: 3, present: 2, marked: 2, pct: 100 },
    ]);
  });

  test('a child never marked this month has no percentage', async () => {
    const d = deps({ monthSessions: jest.fn(async () => []) });
    const out = await Portal().month({ userId: TEACHER, listId: LIST, month: '2026-10' }, d);
    expect(out.days).toEqual([]);
    expect(out.students.every((s) => s.pct === null && s.marked === 0)).toBe(true);
  });

  test.each(['2026-13', '26-10', 'october', null])('month %p is BAD_MONTH', async (month) => {
    const d = deps();
    expect(await Portal().month({ userId: TEACHER, listId: LIST, month }, d)).toEqual({ code: 'BAD_MONTH' });
    expect(d.monthSessions).not.toHaveBeenCalled();
  });
});

describe('register', () => {
  test('the Excel file: the builder WhatsApp uses, for her class and that month', async () => {
    const d = deps();
    const out = await Portal().registerFile({ userId: TEACHER, listId: LIST, month: '2026-10' }, d);
    expect(d.registerParts).toHaveBeenCalledWith(LIST, TEACHER, { year: 2026, month: 10, start: '2026-10-01', end: '2026-10-31' });
    expect(d.buildRegister).toHaveBeenCalledWith({ title: 'Grade 4 - A', subject: 'student' }, 10, 2026, ROSTER, []);
    expect(out).toEqual({ fileName: 'Grade 4 - A, October 2026.xlsx', base64: Buffer.from('xlsx-bytes').toString('base64') });
  });

  test('send to WhatsApp: the existing delivery, for her class and that month', async () => {
    const d = deps();
    const out = await Portal().sendRegister({ userId: TEACHER, listId: LIST, month: '2026-09' }, d);
    expect(d.deliverRegister).toHaveBeenCalledWith({ userId: TEACHER, subject: 'student', targetId: LIST, date: '2026-09-30' });
    expect(out).toEqual({ delivered: true });
  });

  test('this month\'s register runs up to today', async () => {
    const d = deps();
    await Portal().sendRegister({ userId: TEACHER, listId: LIST, month: '2026-10' }, d);
    expect(d.deliverRegister.mock.calls[0][0].date).toBe('2026-10-08');
  });

  test('a delivery that fails says so', async () => {
    const d = deps({ deliverRegister: jest.fn(async () => ({ delivered: false, error: 'no_phone_number' })) });
    expect(await Portal().sendRegister({ userId: TEACHER, listId: LIST, month: '2026-10' }, d))
      .toEqual({ delivered: false, error: 'no_phone_number' });
  });

  test('someone else\'s class is NOT_FOUND for both', async () => {
    const d = deps();
    expect(await Portal().registerFile({ userId: 'u-other', listId: LIST, month: '2026-10' }, d)).toEqual({ code: 'NOT_FOUND' });
    expect(await Portal().sendRegister({ userId: 'u-other', listId: LIST, month: '2026-10' }, d)).toEqual({ code: 'NOT_FOUND' });
    expect(d.buildRegister).not.toHaveBeenCalled();
    expect(d.deliverRegister).not.toHaveBeenCalled();
  });
});
