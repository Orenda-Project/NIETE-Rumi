/**
 * GET /api/portal/hcp/schedules
 *
 * Lists visit schedules the coach has created. Scoped to the caller's own
 * schedules (coach_id = session's portalUserId). Optional query params:
 *   ?status=upcoming|confirmed|reschedule_requested|medical_leave|completed|cancelled
 *   ?teacher_id=<uuid>
 *
 * Access rules:
 *   1. requirePortalAuth.
 *   2. Empty array when the coach has no schedules (not 404).
 *   3. Sorted by scheduled_at descending (soonest upcoming visible near top
 *      when combined with the coach's client-side filter).
 */

let tableStates;
const { installSupabaseMock, invokeRoute, resetTableStates } = require('./_shared');

beforeEach(() => {
  jest.resetModules();
  tableStates = resetTableStates();
  installSupabaseMock(tableStates);
});
afterEach(() => jest.resetModules());

describe('GET /api/portal/hcp/schedules', () => {
  it('requires portal auth (401)', async () => {
    const { statusCode } = await invokeRoute({
      method: 'get', path: '/schedules', userId: null,
    });
    expect(statusCode).toBe(401);
  });

  it('returns the coach\'s schedules', async () => {
    tableStates.hcp_visit_schedules = {
      rows: [
        { id: 'v-1', coach_id: 'coach-1', teacher_id: 't-1', scheduled_at: '2026-07-20T09:00:00Z',
          observation_tool: 'FICO', status: 'upcoming' },
        { id: 'v-2', coach_id: 'coach-1', teacher_id: 't-2', scheduled_at: '2026-07-21T10:00:00Z',
          observation_tool: 'HOTs', status: 'upcoming' },
        { id: 'v-3', coach_id: 'coach-99', teacher_id: 't-3', scheduled_at: '2026-07-22T11:00:00Z',
          observation_tool: 'COTs', status: 'upcoming' },
      ],
    };

    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/schedules', userId: 'coach-1',
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.schedules).toHaveLength(2);
    expect(payload.schedules.every((s) => s.coach_id === 'coach-1')).toBe(true);
  });

  it('filters by status when ?status= is provided', async () => {
    tableStates.hcp_visit_schedules = {
      rows: [
        { id: 'v-1', coach_id: 'coach-1', teacher_id: 't-1', scheduled_at: '2026-07-20T09:00:00Z',
          observation_tool: 'FICO', status: 'upcoming' },
        { id: 'v-2', coach_id: 'coach-1', teacher_id: 't-1', scheduled_at: '2026-07-18T09:00:00Z',
          observation_tool: 'FICO', status: 'completed' },
      ],
    };

    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/schedules', userId: 'coach-1',
      query: { status: 'completed' },
    });

    expect(statusCode).toBe(200);
    expect(payload.schedules).toHaveLength(1);
    expect(payload.schedules[0].status).toBe('completed');
  });

  it('returns empty array when no schedules exist', async () => {
    tableStates.hcp_visit_schedules = { rows: [] };
    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/schedules',
    });
    expect(statusCode).toBe(200);
    expect(payload.schedules).toEqual([]);
  });
});
