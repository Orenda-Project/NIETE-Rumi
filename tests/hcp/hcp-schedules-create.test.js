/**
 * POST /api/portal/hcp/schedules
 *
 * Creates a new visit schedule. Coach picks a teacher, a date/time, and a
 * tool (FICO / HOTs / COTs) from the ScheduleVisit UI. Row is written to
 * hcp_visit_schedules with status='upcoming' and coach_id inferred from the
 * session — never from the request body.
 *
 * Phase 3 will layer on the WhatsApp interactive send (3 buttons) as a
 * side-effect after this insert; that side-effect is out of scope for
 * Phase 1 and is not asserted here.
 *
 * Access rules:
 *   1. requirePortalAuth.
 *   2. 400 on missing teacher_id, scheduled_at, or observation_tool.
 *   3. 400 on invalid observation_tool (must be one of FICO / HOTs / COTs).
 *   4. Returns the created row with status='upcoming' and the coach id from
 *      the session.
 */

let tableStates;
const { installSupabaseMock, invokeRoute, resetTableStates } = require('./_shared');

beforeEach(() => {
  jest.resetModules();
  tableStates = resetTableStates();
  installSupabaseMock(tableStates);
});
afterEach(() => jest.resetModules());

describe('POST /api/portal/hcp/schedules', () => {
  it('requires portal auth (401)', async () => {
    const { statusCode } = await invokeRoute({
      method: 'post', path: '/schedules', userId: null,
      body: { teacher_id: 't-1', scheduled_at: '2026-07-20T09:00:00Z', observation_tool: 'FICO' },
    });
    expect(statusCode).toBe(401);
  });

  it('400 on missing fields', async () => {
    const { statusCode, payload } = await invokeRoute({
      method: 'post', path: '/schedules',
      body: { teacher_id: 't-1' },
    });
    expect(statusCode).toBe(400);
    expect(payload.success).toBe(false);
  });

  it('400 on invalid observation_tool', async () => {
    const { statusCode } = await invokeRoute({
      method: 'post', path: '/schedules',
      body: { teacher_id: 't-1', scheduled_at: '2026-07-20T09:00:00Z', observation_tool: 'BOGUS' },
    });
    expect(statusCode).toBe(400);
  });

  it('creates a schedule with coach_id from session and status=upcoming', async () => {
    tableStates.hcp_visit_schedules = { rows: [] };
    const { statusCode, payload } = await invokeRoute({
      method: 'post', path: '/schedules', userId: 'coach-42',
      body: {
        teacher_id: 't-1',
        scheduled_at: '2026-07-20T09:00:00Z',
        observation_tool: 'FICO',
        notes: 'Focus on questioning strategy',
      },
    });

    expect(statusCode).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.schedule.coach_id).toBe('coach-42');
    expect(payload.schedule.teacher_id).toBe('t-1');
    expect(payload.schedule.observation_tool).toBe('FICO');
    expect(payload.schedule.status).toBe('upcoming');
    expect(payload.schedule.notes).toBe('Focus on questioning strategy');
  });
});
