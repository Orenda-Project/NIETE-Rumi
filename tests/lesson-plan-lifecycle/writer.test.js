/**
 * The lesson-plan lifecycle writer — Lifecycle.recordOutcome and its switch.
 *
 * WHAT IT IS FOR. Every lesson-plan ask must leave one row in lesson_plan_requests: which path served
 * it, when each stage happened, how it ended, and the correlation id of its logs — so an analyst can
 * trace any plan seen in the portal back to its ask and its logs. The queue path (grounded) already
 * keeps such a row; recordOutcome is how every OTHER path (v8, 6-12, pic-to-LP) records its ask once
 * it has reached its end.
 *
 * THE RULES THIS PINS.
 *   1. Switched per path by LP_LIFECYCLE_PATHS ('all' or a comma list of sources). Unset, the writer
 *      makes NO database call at all — the deployment behaves exactly as before.
 *   2. One upsert on the ask's id: a retried call rewrites the same row, never adds a second (D13).
 *   3. Soft-fail: a write that fails costs the teacher nothing — recordOutcome never throws, returns
 *      null, and the caller carries on delivering. A missing column (the migration not applied yet)
 *      is said at error level once per ten minutes, not once per delivery, and retried after that.
 *   4. The row says where it came from: region from REGION, correlation id from the request context.
 */

const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
const mockEvent = jest.fn();
let mockCorrelationId = 'corr-from-context';
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockEvent(...a),
  getCurrentCorrelationId: () => mockCorrelationId,
}));

const { createMemorySupabase } = require('../quiz/helpers/memory-supabase');

let mockDb;
let mockFail = null; // null | { code, message } — the next lesson_plan_requests write returns this error
let mockCalls = 0;
let mockTables = []; // every table recordOutcome touched, in order
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => {
    mockCalls += 1;
    mockTables.push(t);
    if (t === 'lesson_plan_requests' && mockFail) {
      const err = { data: null, error: mockFail };
      const b = new Proxy({}, {
        get: (_, k) => (k === 'then' ? (res) => Promise.resolve(err).then(res) : (k === 'single' || k === 'maybeSingle' ? async () => err : () => b)),
      });
      return b;
    }
    return mockDb.from(t);
  },
}));

const Lifecycle = require('../../bot/shared/services/lesson-plan-lifecycle.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const ASK = {
  userId: TEACHER,
  phone: '923001234567',
  topic: 'Sets & notation',
  language: 'ur',
  source: 'niete_lp612',
  channel: 'whatsapp',
  grade: 8,
  subject: 'Mathematics',
  artifactRef: 'grade_8_mathematics.c05.p071-073',
  status: 'completed',
  askedAt: '2026-10-13T05:00:00.000Z',
  startedAt: '2026-10-13T05:00:01.000Z',
  generatedAt: '2026-10-13T05:02:00.000Z',
  deliveredAt: '2026-10-13T05:02:03.000Z',
};

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.LP_LIFECYCLE_PATHS;
  process.env.REGION = 'niete';
  mockDb = createMemorySupabase({ lesson_plan_requests: [] });
  mockFail = null;
  mockCalls = 0;
  mockTables = [];
  mockCorrelationId = 'corr-from-context';
  mockLog.mockClear();
  mockEvent.mockClear();
  Lifecycle.__resetForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('the switch — LP_LIFECYCLE_PATHS', () => {
  test.each([
    [undefined, 'niete_lp612', false],
    ['', 'niete_lp612', false],
    ['all', 'niete_lp612', true],
    ['all', 'niete_v8_segment', true],
    ['niete_lp612', 'niete_lp612', true],
    ['niete_lp612', 'niete_v8_segment', false],
    [' niete_v8_segment , niete_lp612 ', 'niete_lp612', true],
    ['niete_lp612', 'not_a_path', false],
    ['all', 'not_a_path', false],
    ['1', 'niete_v8_segment', true],
    ['true', 'niete_lp612', true],
    ['ALL', 'niete_lp612', true],
    ['0', 'niete_lp612', false],
    ['false', 'niete_lp612', false],
  ])('LP_LIFECYCLE_PATHS=%p → %s enabled: %p', (value, source, expected) => {
    if (value === undefined) delete process.env.LP_LIFECYCLE_PATHS; else process.env.LP_LIFECYCLE_PATHS = value;
    expect(Lifecycle.enabled(source)).toBe(expected);
  });

  test('switched off, recordOutcome makes no database call and returns null', async () => {
    const id = await Lifecycle.recordOutcome(ASK);
    expect(id).toBeNull();
    expect(mockCalls).toBe(0);
    expect(mockDb.table('lesson_plan_requests')).toHaveLength(0);
    expect(mockEvent).not.toHaveBeenCalled();
  });

  test('the first switch read in a process says once what it resolved to', () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    Lifecycle.enabled('niete_lp612');
    Lifecycle.enabled('niete_v8_segment');
    const said = mockLog.mock.calls.filter((c) => /lifecycle switch resolved/.test(c[0]));
    expect(said).toHaveLength(1);
    expect(said[0][1]).toEqual({ LP_LIFECYCLE_PATHS: 'niete_lp612', pathsOn: ['niete_lp612'] });
  });

  test('switched on for a different path only, it still makes no call', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment';
    expect(await Lifecycle.recordOutcome(ASK)).toBeNull();
    expect(mockCalls).toBe(0);
  });
});

describe('recordOutcome — one row per ask, with its path, stage times and log id', () => {
  beforeEach(() => { process.env.LP_LIFECYCLE_PATHS = 'all'; });

  test('a delivered ask writes one completed row carrying every lifecycle field', async () => {
    const id = await Lifecycle.recordOutcome(ASK);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const rows = mockDb.table('lesson_plan_requests');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      id,
      user_id: TEACHER,
      phone_number: '923001234567',
      topic: 'Sets & notation',
      full_message: 'Sets & notation',
      language: 'ur',
      content_type: 'lesson_plan',
      status: 'completed',
      source: 'niete_lp612',
      channel: 'whatsapp',
      region: 'niete',
      grade: 8,
      subject: 'Mathematics',
      artifact_ref: 'grade_8_mathematics.c05.p071-073',
      created_at: '2026-10-13T05:00:00.000Z',
      processing_started_at: '2026-10-13T05:00:01.000Z',
      generated_at: '2026-10-13T05:02:00.000Z',
      delivered_at: '2026-10-13T05:02:03.000Z',
      completed_at: '2026-10-13T05:02:03.000Z',
      error_code: null,
      error_message: null,
      correlation_id: 'corr-from-context',
    }));
  });

  test('the caller can name the id up front, and a retried call rewrites that row instead of adding one', async () => {
    const id = require('crypto').randomUUID();
    expect(await Lifecycle.recordOutcome({ ...ASK, id })).toBe(id);
    expect(await Lifecycle.recordOutcome({ ...ASK, id })).toBe(id);
    expect(mockDb.table('lesson_plan_requests')).toHaveLength(1);
  });

  test('a failed ask writes a failed row with its error code and no delivery time', async () => {
    const id = await Lifecycle.recordOutcome({
      ...ASK, status: 'failed', deliveredAt: undefined, errorCode: 'DELIVERY_FAILED', errorMessage: 'document send failed',
    });
    const [row] = mockDb.table('lesson_plan_requests');
    expect(row.id).toBe(id);
    expect(row).toEqual(expect.objectContaining({
      status: 'failed', error_code: 'DELIVERY_FAILED', error_message: 'document send failed',
      delivered_at: null, completed_at: null, generated_at: '2026-10-13T05:02:00.000Z',
    }));
  });

  test('a correlation id passed in wins over the one in context; none at all is stored as null', async () => {
    await Lifecycle.recordOutcome({ ...ASK, correlationId: 'corr-explicit' });
    mockCorrelationId = undefined;
    await Lifecycle.recordOutcome(ASK);
    const rows = mockDb.table('lesson_plan_requests');
    expect(rows.map((r) => r.correlation_id)).toEqual(['corr-explicit', null]);
  });

  test('inputs are validated at the point of entry: grade 1-12 only, topic cut to the column, phone digits only', async () => {
    await Lifecycle.recordOutcome({ ...ASK, grade: '13', topic: 'x'.repeat(600), phone: '+92 300 1234567' });
    await Lifecycle.recordOutcome({ ...ASK, grade: '5' });
    const [a, b] = mockDb.table('lesson_plan_requests');
    expect(a.grade).toBeNull();
    expect(a.topic).toHaveLength(500);
    expect(a.phone_number).toBe('923001234567');
    expect(b.grade).toBe(5);
  });

  test.each(['pending', 'processing'])(
    'TERMINAL ONLY: a %s outcome is refused — an in-flight row would surface in /status, the busy probe and the stale sweeper',
    async (status) => {
      expect(await Lifecycle.recordOutcome({ ...ASK, status })).toBeNull();
      expect(mockDb.table('lesson_plan_requests')).toHaveLength(0);
    },
  );

  test('an unknown path, status or channel is refused before any write', async () => {
    expect(await Lifecycle.recordOutcome({ ...ASK, source: 'gamma' })).toBeNull();
    expect(await Lifecycle.recordOutcome({ ...ASK, status: 'extracting' })).toBeNull();
    expect(await Lifecycle.recordOutcome({ ...ASK, channel: 'sms' })).toBeNull();
    expect(mockDb.table('lesson_plan_requests')).toHaveLength(0);
  });

  test('no teacher or no phone (nothing the table can key or must hold) writes nothing and does not throw', async () => {
    expect(await Lifecycle.recordOutcome({ ...ASK, userId: null })).toBeNull();
    expect(await Lifecycle.recordOutcome({ ...ASK, phone: '' })).toBeNull();
    expect(mockDb.table('lesson_plan_requests')).toHaveLength(0);
  });

  test('every recorded outcome emits the canonical event with the ids an analyst joins on', async () => {
    const id = await Lifecycle.recordOutcome(ASK);
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.delivery.sent', expect.objectContaining({
      requestId: id, userId: TEACHER, source: 'niete_lp612', channel: 'whatsapp', region: 'niete',
      correlationId: 'corr-from-context',
    }));
    mockEvent.mockClear();
    const failed = await Lifecycle.recordOutcome({ ...ASK, status: 'failed', errorCode: 'RENDER_FAILED', generatedAt: undefined, deliveredAt: undefined });
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.generation.failed', expect.objectContaining({ requestId: failed, errorCode: 'RENDER_FAILED' }));
    mockEvent.mockClear();
    await Lifecycle.recordOutcome({ ...ASK, status: 'failed', errorCode: 'DELIVERY_FAILED', deliveredAt: undefined });
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.delivery.failed', expect.objectContaining({ errorCode: 'DELIVERY_FAILED' }));
  });
});

describe('soft-fail — the record is never the reason a lesson does not reach the teacher', () => {
  beforeEach(() => { process.env.LP_LIFECYCLE_PATHS = 'all'; });

  test('a database error returns null and does not throw', async () => {
    mockFail = { code: '57014', message: 'canceling statement due to statement timeout' };
    await expect(Lifecycle.recordOutcome(ASK)).resolves.toBeNull();
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.lifecycle.write_failed', expect.objectContaining({ code: '57014' }));
  });

  test('a missing column (migration not applied yet) is said at error level ONCE per ten minutes, not per delivery', async () => {
    mockFail = { code: 'PGRST204', message: "Could not find the 'source' column of 'lesson_plan_requests' in the schema cache" };
    await Lifecycle.recordOutcome(ASK);
    await Lifecycle.recordOutcome(ASK);
    await Lifecycle.recordOutcome(ASK);
    const loud = mockLog.mock.calls.filter((c) => c[2] === 'error' && /lesson_plan_requests/.test(JSON.stringify(c)));
    expect(loud).toHaveLength(1);
  });

  test('a structured-logger stub without getCurrentCorrelationId (183 suites use one) does not break the write', async () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
    const Fresh = require('../../bot/shared/services/lesson-plan-lifecycle.service');
    const id = await Fresh.recordOutcome(ASK);
    expect(id).not.toBeNull();
    jest.dontMock('../../bot/shared/utils/structured-logger');
  });

  test('a throw from the client itself is caught too', async () => {
    const realFrom = mockDb.from;
    mockDb.from = () => { throw new Error('socket hang up'); };
    await expect(Lifecycle.recordOutcome(ASK)).resolves.toBeNull();
    mockDb.from = realFrom;
  });
});

describe('an ask that arrives without a phone — a portal or teacher-app ask carries only her id', () => {
  // The portal and the app name the teacher by users.id alone; lesson_plan_requests.phone_number is
  // NOT NULL. Before this, every such ask was refused ('no_phone') — so the asks made where most NIETE
  // teachers now read their plans left no row at all.
  const PORTAL_ASK = { ...ASK, phone: undefined, language: undefined, channel: 'portal' };
  const seedTeacher = (over = {}) => {
    mockDb = createMemorySupabase({
      lesson_plan_requests: [],
      users: [{ id: TEACHER, phone_number: '+92 300 1234567', preferred_language: 'ur', ...over }],
    });
  };
  beforeEach(() => { process.env.LP_LIFECYCLE_PATHS = 'all'; });

  test('her phone — and her language, when the caller gave none — come from users, in one read by id', async () => {
    seedTeacher();
    const id = await Lifecycle.recordOutcome(PORTAL_ASK);
    expect(id).not.toBeNull();
    const [row] = mockDb.table('lesson_plan_requests');
    expect(row).toEqual(expect.objectContaining({
      id, user_id: TEACHER, phone_number: '923001234567', language: 'ur', channel: 'portal', status: 'completed',
    }));
    expect(mockTables.filter((t) => t === 'users')).toHaveLength(1);
  });

  test('a language the caller did give is kept', async () => {
    seedTeacher();
    await Lifecycle.recordOutcome({ ...PORTAL_ASK, language: 'en' });
    expect(mockDb.table('lesson_plan_requests')[0].language).toBe('en');
  });

  test('a teacher with no phone on file is refused — no row, no throw, the refusal said', async () => {
    seedTeacher({ phone_number: null });
    await expect(Lifecycle.recordOutcome(PORTAL_ASK)).resolves.toBeNull();
    expect(mockDb.table('lesson_plan_requests')).toHaveLength(0);
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.lifecycle.refused', expect.objectContaining({ reason: 'no_phone' }));
  });

  test('a users read that fails is refused, never thrown', async () => {
    seedTeacher();
    const realFrom = mockDb.from;
    mockDb.from = (t) => { if (t === 'users') throw new Error('socket hang up'); return realFrom(t); };
    await expect(Lifecycle.recordOutcome(PORTAL_ASK)).resolves.toBeNull();
    mockDb.from = realFrom;
    expect(mockDb.table('lesson_plan_requests')).toHaveLength(0);
  });

  test('a caller that already has the phone makes no users read', async () => {
    seedTeacher();
    await Lifecycle.recordOutcome(ASK);
    expect(mockTables).not.toContain('users');
  });

  test('switched off: no read of users either — the phone lookup is part of the switched-on write', async () => {
    delete process.env.LP_LIFECYCLE_PATHS;
    seedTeacher();
    expect(await Lifecycle.recordOutcome(PORTAL_ASK)).toBeNull();
    expect(mockCalls).toBe(0);
  });
});
