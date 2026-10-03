/**
 * bd-5rz1v.17 (server) + bd-5rz1v.15 — the Home's counts, the list behind each, and her recent
 * lesson plans.
 *
 *   GET /api/portal/progress?range=…&from=&to=      five counts for a range (default this month)
 *   GET /api/portal/progress/:metric?range=…        the items behind one count, same range
 *   GET /api/portal/lesson-plans/recent?limit=      her plans, most recently used first
 *
 * What these tests hold the routes to:
 *   - signed-in only, and the teacher is the SESSION's user (a UUID) — no id parameter exists;
 *   - the range is resolved once, in Pakistan time, and the SAME from/to reach the SQL and the
 *     response (the window the numbers were counted in is the window she is told);
 *   - a bad range is a 400 she can fix, never a silent fallback to the default;
 *   - counts arrive as numbers (pg returns COUNT as a string);
 *   - a list's `total` is the tile's count, so the number on the tile and the list it opens agree;
 *   - plan names come from the bot (the portal holds no catalogue), merged by plan key.
 *
 * The rules of each COUNT (which rows, which visibility) run against a real database in
 * progress-counts.db.test.js; here the pool is mocked at the network boundary.
 */

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
let poolQuery;
let describePlans;

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(path, { userId = TEACHER, query = {}, params = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', path);
  if (!stack) throw new Error(`Route GET ${path} not found`);
  const req = {
    session: userId ? { portalUserId: userId, id: 's1' } : null, params, query,
    method: 'GET', path, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (advanced === false) resolve();
    });
  }
  return { statusCode, payload };
}

const COUNTS_ROW = {
  lp_used: '14', lp_opened: '3', lp_received: '12', lp_days: '9',
  training_completed: '6',
  coaching_digital: '1', coaching_observations: '2',
  assessments_made: '4',
  attendance_days: '18', attendance_registers: '20',
};

const PLAN_ROWS = [
  { kind: 'k5', ref: 'grade_4_science_ch2_seg3', lang: null,
    last_used_at: '2026-10-02T06:00:00.000Z', last_opened_at: '2026-10-02T06:00:00.000Z', last_received_at: null },
  { kind: 'g612', ref: 'grade_9_physics.c02.p010', lang: 'ur',
    last_used_at: '2026-10-01T04:00:00.000Z', last_opened_at: null, last_received_at: '2026-10-01T04:00:00.000Z' },
];

beforeEach(() => {
  jest.resetModules();
  poolQuery = jest.fn(async (sql) => {
    if (/AS lp_used/.test(sql)) return { rows: [COUNTS_ROW] };
    if (/GROUP BY kind, ref/.test(sql)) return { rows: PLAN_ROWS };
    if (/FROM coaching_sessions/.test(sql)) {
      return { rows: [
        { id: 'c1', created_at: '2026-10-02T05:00:00Z', observation_type: null, observer_name: null, observer_role: null,
          scores: { overall_marks: 30, overall_max_marks: 42, overall_percentage: 71.4 }, topic: 'Leaves', subject: 'science' },
        { id: 'c2', created_at: '2026-09-12T05:00:00Z', observation_type: 'leader_observation', observer_name: 'Sana', observer_role: 'coach',
          scores: { overall_marks: 20, overall_max_marks: 42, overall_percentage: 47.6 }, topic: null, subject: null },
        { id: 'c3', created_at: '2026-09-02T05:00:00Z', observation_type: 'leader_observation', observer_name: 'Amna', observer_role: 'principal',
          scores: null, topic: null, subject: null },
      ] };
    }
    return { rows: [] };
  });
  describePlans = jest.fn(async (plans) => plans.map((p) => (p.kind === 'k5'
    ? { kind: 'k5', ref: p.ref, lang: null, found: true, title: 'Leaves make food', grade: 4, subject: 'Science',
      chapterNumber: 2, chapterTitle: 'Plants', dayLabel: 'Day 3', pagesLabel: 'p.21' }
    : { kind: 'g612', ref: p.ref, lang: p.lang, found: true, title: 'Speed and velocity', grade: 9, subject: 'Physics',
      chapterNumber: 2, chapterTitle: 'Kinematics', dayLabel: null, pagesLabel: 'p.10-12' })));

  jest.doMock('../../dashboard/config/database', () => ({ query: poolQuery }));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/lp-catalogue.service', () => ({
    listGrades: jest.fn(), listSubjects: jest.fn(), listChapters: jest.fn(), listLessons: jest.fn(),
    lessonPdf: jest.fn(), describePlans,
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // Saturday 3 Oct 2026, 15:00 in Pakistan. Only Date is faked: the routes' promises still run.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask', 'clearTimeout', 'clearInterval', 'clearImmediate'] });
  jest.setSystemTime(new Date('2026-10-03T10:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('signed-in only', () => {
  test.each([
    ['/progress', {}],
    ['/progress/:metric', { metric: 'lesson-plans' }],
    ['/lesson-plans/recent', {}],
  ])('%s answers 401 without a session and reads nothing', async (path, params) => {
    const { statusCode } = await invoke(path, { userId: null, params });
    expect(statusCode).toBe(401);
    expect(poolQuery).not.toHaveBeenCalled();
  });
});

describe('GET /progress — the five counts', () => {
  test('defaults to this month in Pakistan time, and says so', async () => {
    const { statusCode, payload } = await invoke('/progress');
    expect(statusCode).toBe(200);
    expect(payload.range).toEqual({ key: 'this_month', from: '2026-10-01', to: '2026-10-03', timezone: 'Asia/Karachi' });
    const [, params] = poolQuery.mock.calls.find(([sql]) => /AS lp_used/.test(sql));
    expect(params).toEqual([TEACHER, '2026-10-01', '2026-10-03']);
  });

  test('returns each count as a number, with the coaching split', async () => {
    const { payload } = await invoke('/progress', { query: { range: 'this_month' } });
    expect(payload).toMatchObject({
      success: true,
      lessonPlans: { used: 14, opened: 3, received: 12, days: 9 },
      training: { completed: 6 },
      coaching: { total: 3, digitalCoach: 1, observations: 2 },
      assessments: { made: 4 },
      attendance: { days: 18, registers: 20, unit: 'days' },
    });
  });

  test('one round trip: every count comes from a single statement', async () => {
    await invoke('/progress');
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  test('all time passes open ends', async () => {
    const { payload } = await invoke('/progress', { query: { range: 'all' } });
    expect(payload.range).toMatchObject({ key: 'all', from: null, to: null });
    expect(poolQuery.mock.calls[0][1]).toEqual([TEACHER, null, null]);
  });

  test('a custom range reaches the SQL exactly as resolved', async () => {
    await invoke('/progress', { query: { range: 'custom', from: '2026-08-15', to: '2026-09-14' } });
    expect(poolQuery.mock.calls[0][1]).toEqual([TEACHER, '2026-08-15', '2026-09-14']);
  });

  test.each([
    [{ range: 'custom', from: '2026-09-02', to: '2026-09-01' }],
    [{ range: 'custom', from: "x'; drop table users; --", to: '2026-09-01' }],
    [{ range: 'fortnight' }],
  ])('a bad range is a 400 and nothing is read: %j', async (query) => {
    const { statusCode, payload } = await invoke('/progress', { query });
    expect(statusCode).toBe(400);
    expect(payload.success).toBe(false);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('a ?userId= is ignored — the session decides whose counts these are', async () => {
    await invoke('/progress', { query: { userId: 'someone-else' } });
    expect(poolQuery.mock.calls[0][1][0]).toBe(TEACHER);
  });

  test('a database failure is a 500, not a page of zeros', async () => {
    poolQuery.mockRejectedValue(new Error('down'));
    const { statusCode, payload } = await invoke('/progress');
    expect(statusCode).toBe(500);
    expect(payload.success).toBe(false);
  });
});

describe('GET /progress/:metric — the list behind a tile', () => {
  test('lesson plans: named by the bot, newest first, total = the tile', async () => {
    const { statusCode, payload } = await invoke('/progress/:metric', { params: { metric: 'lesson-plans' }, query: { range: 'this_month' } });
    expect(statusCode).toBe(200);
    expect(payload.metric).toBe('lesson-plans');
    expect(payload.total).toBe(14);
    expect(payload.items[0]).toMatchObject({
      planKey: 'k5:grade_4_science_ch2_seg3', kind: 'k5', lessonId: 'grade_4_science_ch2_seg3',
      title: 'Leaves make food', grade: 4, subject: 'Science', chapterNumber: 2, dayLabel: 'Day 3',
      lastUsedAt: '2026-10-02T06:00:00.000Z', lastOpenedAt: '2026-10-02T06:00:00.000Z', lastReceivedAt: null,
      open: { lane: 'k5', lessonId: 'grade_4_science_ch2_seg3' },
    });
    expect(payload.items[1]).toMatchObject({
      planKey: 'g612:grade_9_physics.c02.p010', kind: 'g612', segmentId: 'grade_9_physics.c02.p010', lang: 'ur',
      open: { lane: 'g612', segmentId: 'grade_9_physics.c02.p010', lang: 'ur' },
    });
    expect(describePlans).toHaveBeenCalledWith([
      { kind: 'k5', ref: 'grade_4_science_ch2_seg3', lang: null },
      { kind: 'g612', ref: 'grade_9_physics.c02.p010', lang: 'ur' },
    ]);
    const [, params] = poolQuery.mock.calls.find(([sql]) => /GROUP BY kind, ref/.test(sql));
    expect(params.slice(0, 3)).toEqual([TEACHER, '2026-10-01', '2026-10-03']);
  });

  test('coaching: each item says what it was and who observed, rated as a band — never a number', async () => {
    const { payload } = await invoke('/progress/:metric', { params: { metric: 'coaching' } });
    expect(payload.total).toBe(3);
    expect(payload.items).toEqual([
      expect.objectContaining({ id: 'c1', kind: 'digital_coach', observerRole: null, band: 'good', topic: 'Leaves' }),
      expect.objectContaining({ id: 'c2', kind: 'observation', observerRole: 'coach', observerName: 'Sana', band: 'average' }),
      expect.objectContaining({ id: 'c3', kind: 'observation', observerRole: 'principal', band: null }),
    ]);
    for (const item of payload.items) {
      expect(item).not.toHaveProperty('percentage');
      expect(item).not.toHaveProperty('score');
    }
  });

  // bd-5rz1v.17.2 — the Training, Assessments and Attendance lists inside Home.
  test('training: each module done names its provider, so the row can carry the provider chip', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/AS lp_used/.test(sql)) return { rows: [COUNTS_ROW] };
      if (/ORDER BY p\.completed_at/.test(sql)) {
        return { rows: [
          { module_id: 41, completed_at: '2026-10-02T05:00:00Z', module_title: 'Group work', course_title: 'Classroom routines',
            vendor_key: 'TALEEMABAD', vendor_name: 'Taleemabad' },
          { module_id: 7, completed_at: '2026-10-01T05:00:00Z', module_title: 'Reading aloud', course_title: null,
            vendor_key: null, vendor_name: null },
        ] };
      }
      return { rows: [] };
    });
    const { statusCode, payload } = await invoke('/progress/:metric', { params: { metric: 'training' } });
    expect(statusCode).toBe(200);
    expect(payload.total).toBe(6);
    expect(payload.items).toEqual([
      { moduleId: '41', title: 'Group work', courseTitle: 'Classroom routines', vendorKey: 'TALEEMABAD', vendorName: 'Taleemabad',
        completedAt: '2026-10-02T05:00:00.000Z' },
      { moduleId: '7', title: 'Reading aloud', courseTitle: null, vendorKey: null, vendorName: null,
        completedAt: '2026-10-01T05:00:00.000Z' },
    ]);
    const [sql] = poolQuery.mock.calls.find(([s]) => /ORDER BY p\.completed_at/.test(s));
    // The provider is the level's vendor: module → course → level → vendor.
    expect(sql).toMatch(/JOIN training_levels tl ON tl\.id = tc\.level_id/);
    expect(sql).toMatch(/JOIN training_vendors tv ON tv\.id = tl\.vendor_id/);
  });

  test('assessments: each paper carries what its sheet shows — subject name, questions, marks, whether it has a key', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/AS lp_used/.test(sql)) return { rows: [COUNTS_ROW] };
      if (/ORDER BY ap\.created_at/.test(sql)) {
        return { rows: [
          { paper_id: 'p-1', grade_code: 'grade_4', subject_code: 'science', chapter_number: 2, created_at: '2026-10-02T05:00:00Z',
            question_count: 15, total_marks: 30, has_answer_key: true },
          { paper_id: 'p-2', grade_code: 'grade_2', subject_code: 'general_knowledge', chapter_number: null, created_at: '2026-10-01T05:00:00Z',
            question_count: null, total_marks: null, has_answer_key: false },
        ] };
      }
      return { rows: [] };
    });
    const { statusCode, payload } = await invoke('/progress/:metric', { params: { metric: 'assessments' } });
    expect(statusCode).toBe(200);
    expect(payload.total).toBe(4);
    expect(payload.items).toEqual([
      { paperId: 'p-1', grade: 4, subjectKey: 'science', subject: 'Science', chapterNumber: 2,
        questionCount: 15, totalMarks: 30, hasAnswerKey: true, createdAt: '2026-10-02T05:00:00.000Z' },
      { paperId: 'p-2', grade: 2, subjectKey: 'general_knowledge', subject: 'General Knowledge', chapterNumber: null,
        questionCount: null, totalMarks: null, hasAnswerKey: false, createdAt: '2026-10-01T05:00:00.000Z' },
    ]);
    const [sql] = poolQuery.mock.calls.find(([s]) => /ORDER BY ap\.created_at/.test(s));
    expect(sql).toMatch(/ap\.answer_key_r2_key IS NOT NULL/);
  });

  test('attendance: a day each, its registers and the classes marked', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/AS lp_used/.test(sql)) return { rows: [COUNTS_ROW] };
      if (/GROUP BY s\.session_date/.test(sql)) {
        return { rows: [{ date: '2026-10-02', registers: '2', classes: ['4-A', '5-B'] }] };
      }
      return { rows: [] };
    });
    const { payload } = await invoke('/progress/:metric', { params: { metric: 'attendance' } });
    expect(payload.total).toBe(18);
    expect(payload.items).toEqual([{ date: '2026-10-02', registers: 2, classes: ['4-A', '5-B'] }]);
  });

  test('an unknown metric is a 404', async () => {
    const { statusCode } = await invoke('/progress/:metric', { params: { metric: 'salaries' } });
    expect(statusCode).toBe(404);
  });

  test('the bot being unreachable is a 502 she can retry, not an empty list', async () => {
    describePlans.mockRejectedValue(new Error('ECONNREFUSED'));
    const { statusCode } = await invoke('/progress/:metric', { params: { metric: 'lesson-plans' } });
    expect(statusCode).toBe(502);
  });
});

describe('GET /lesson-plans/recent', () => {
  test('her plans across the portal and WhatsApp, all time, newest first', async () => {
    const { statusCode, payload } = await invoke('/lesson-plans/recent');
    expect(statusCode).toBe(200);
    expect(payload.plans.map((p) => p.planKey)).toEqual(['k5:grade_4_science_ch2_seg3', 'g612:grade_9_physics.c02.p010']);
    const [, params] = poolQuery.mock.calls.find(([sql]) => /GROUP BY kind, ref/.test(sql));
    expect(params).toEqual([TEACHER, null, null, 10]);
  });

  test('?limit= is honoured and capped at 50', async () => {
    await invoke('/lesson-plans/recent', { query: { limit: '3' } });
    expect(poolQuery.mock.calls.at(-1)[1][3]).toBe(3);
    await invoke('/lesson-plans/recent', { query: { limit: '5000' } });
    expect(poolQuery.mock.calls.at(-1)[1][3]).toBe(50);
    await invoke('/lesson-plans/recent', { query: { limit: 'lots' } });
    expect(poolQuery.mock.calls.at(-1)[1][3]).toBe(10);
  });

  test('nothing used yet is an empty list, and the bot is not asked', async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    const { payload } = await invoke('/lesson-plans/recent');
    expect(payload.plans).toEqual([]);
    expect(describePlans).not.toHaveBeenCalled();
  });
});
