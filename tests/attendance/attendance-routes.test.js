/**
 * Router tests for /api/portal/attendance/*
 *
 * Uses the same jest.doMock + fake-supabase-chain pattern as the HCP tests.
 * Verifies: auth guard, principal-role guard, presence shape, mark validation.
 */

// Force the mock repo path so the routes don't need a live Supabase.
// The router also uses the mocked supabase for the user-context load.
process.env.ATTENDANCE_REPO = 'mock';

const { installSupabaseMock, invokeRoute, resetTableStates } = require('./_shared');

const SCHOOL = 'school-uuid-1';
const OTHER_SCHOOL = 'school-uuid-2';
const PRINCIPAL = 'user-p';
const TEACHER = 'user-t1';
const OUTSIDER = 'user-t2';

function seedTables() {
  return {
    users: {
      rows: [
        { id: PRINCIPAL, first_name: 'Sana', last_name: 'Iqbal', phone_number: '923003333333', role: 'principal', school_id: SCHOOL },
        { id: TEACHER,  first_name: 'Aisha', last_name: 'Rehman', phone_number: '923001111111', role: 'teacher', school_id: SCHOOL },
        { id: OUTSIDER, first_name: 'Zaid',  last_name: 'Ali',    phone_number: '923004444444', role: 'teacher', school_id: OTHER_SCHOOL },
      ],
    },
    schools: {
      rows: [
        { id: SCHOOL, name: 'FGSS Rawalpindi', region: 'Urban-I', principal_user_id: PRINCIPAL },
        { id: OTHER_SCHOOL, name: 'FGES Sihala', region: 'Sihala', principal_user_id: null },
      ],
    },
    teacher_attendance_records: {
      rows: [],
    },
  };
}

describe('/api/portal/attendance auth + role', () => {
  beforeEach(() => { jest.resetModules(); });

  test('GET /school without session → 401', async () => {
    const tables = seedTables();
    installSupabaseMock(tables);
    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/school', userId: null,
    });
    expect(statusCode).toBe(401);
    expect(payload.success).toBe(false);
  });

  test('GET /school with non-principal user → 403', async () => {
    const tables = seedTables();
    installSupabaseMock(tables);
    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/school', userId: TEACHER,
    });
    expect(statusCode).toBe(403);
    expect(payload.error).toMatch(/Principal role required/);
  });

  test('POST /mark by non-principal → 403', async () => {
    const tables = seedTables();
    installSupabaseMock(tables);
    const { statusCode, payload } = await invokeRoute({
      method: 'post', path: '/mark', userId: TEACHER,
      body: { teacher_id: TEACHER, date: '2026-07-16', status: 'present' },
    });
    expect(statusCode).toBe(403);
    expect(payload.error).toMatch(/Principal role required/);
  });
});

describe('/api/portal/attendance POST /mark validation', () => {
  beforeEach(() => { jest.resetModules(); });

  test('rejects when teacher_id/date/status missing → 400', async () => {
    installSupabaseMock(seedTables());
    const { statusCode, payload } = await invokeRoute({
      method: 'post', path: '/mark', userId: PRINCIPAL,
      body: { teacher_id: TEACHER, date: '2026-07-16' /* no status */ },
    });
    expect(statusCode).toBe(400);
    expect(payload.error).toMatch(/status/);
  });

  test('rejects leave without leave_type → 400', async () => {
    // Note: the mock repo throws inside saveAttendance — route returns 400.
    installSupabaseMock(seedTables());
    const { statusCode, payload } = await invokeRoute({
      method: 'post', path: '/mark', userId: PRINCIPAL,
      body: { teacher_id: TEACHER, date: '2026-07-16', status: 'leave' },
    });
    expect(statusCode).toBe(400);
    expect(payload.error).toMatch(/leave_type/);
  });

  test('rejects marking a teacher in a different school → 403', async () => {
    installSupabaseMock(seedTables());
    const { statusCode, payload } = await invokeRoute({
      method: 'post', path: '/mark', userId: PRINCIPAL,
      body: { teacher_id: OUTSIDER, date: '2026-07-16', status: 'present' },
    });
    expect(statusCode).toBe(403);
    expect(payload.error).toMatch(/does not belong/);
  });

  test('accepts a valid present mark → 200', async () => {
    installSupabaseMock(seedTables());
    const { statusCode, payload } = await invokeRoute({
      method: 'post', path: '/mark', userId: PRINCIPAL,
      body: { teacher_id: TEACHER, date: '2026-07-16', status: 'present' },
    });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.record.teacher_id).toBe(TEACHER);
    expect(payload.record.status).toBe('present');
  });
});

describe('/api/portal/attendance GET /presence shape', () => {
  beforeEach(() => { jest.resetModules(); });

  test('by teacher_id returns Hasnat-approved keys', async () => {
    installSupabaseMock(seedTables());
    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/presence', userId: TEACHER,
      query: { teacher_id: TEACHER },
    });
    expect(statusCode).toBe(200);
    // ATTENDANCE_REPO=mock creates an empty in-memory repo per call, so no records exist.
    // The shape is still what STEPS consumes.
    // ATTENDANCE_REPO=mock instantiates an empty repo per request, so no
    // teacher/record data exists. What matters is the ROUTE's response shape
    // matches Hasnat's approved keys.
    expect(payload).toEqual({
      success: true,
      teacher_id: TEACHER,
      mobile: null,
      school_id: null,
      period_start: null,
      period_end: null,
      present_days: 0,
      absent_days: 0,
      leave_days: 0,
      working_days: 0,
      presence_pct: 0,
    });
  });

  test('by school_id returns teachers array (principal only)', async () => {
    installSupabaseMock(seedTables());
    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/presence', userId: PRINCIPAL,
      query: { school_id: SCHOOL },
    });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(Array.isArray(payload.teachers)).toBe(true);
  });

  test('by school_id as non-principal → 403', async () => {
    installSupabaseMock(seedTables());
    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/presence', userId: TEACHER,
      query: { school_id: SCHOOL },
    });
    expect(statusCode).toBe(403);
    expect(payload.error).toMatch(/Principal/);
  });

  test('no selector → 400', async () => {
    installSupabaseMock(seedTables());
    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/presence', userId: PRINCIPAL,
      query: {},
    });
    expect(statusCode).toBe(400);
    expect(payload.error).toMatch(/required/);
  });
});

describe('/api/portal/attendance GET /me', () => {
  beforeEach(() => { jest.resetModules(); });

  test('teacher can read own record → 200 with rollup keys', async () => {
    installSupabaseMock(seedTables());
    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/me', userId: TEACHER,
    });
    expect(statusCode).toBe(200);
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      teacher_id: TEACHER,
      mobile: '923001111111',
      records: expect.any(Array),
      present_days: 0,
      working_days: 0,
      presence_pct: 0,
    }));
  });

  test('unauthenticated /me → 401', async () => {
    installSupabaseMock(seedTables());
    const { statusCode } = await invokeRoute({
      method: 'get', path: '/me', userId: null,
    });
    expect(statusCode).toBe(401);
  });
});
