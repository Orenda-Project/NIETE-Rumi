/**
 * PATCH /api/portal/hcp/schedules/:id
 *
 * Updates a schedule's status. Called both by the coach's UI (mark completed
 * / cancel) and — in Phase 3 — by the WhatsApp button-response handler when
 * the teacher taps Confirm / Reschedule / Medical Leave on the interactive
 * message.
 *
 * Access rules:
 *   1. requirePortalAuth.
 *   2. 404 when the schedule id does not exist.
 *   3. 400 on invalid target status.
 *   4. 409 on invalid state transition (e.g. can't move `completed` → `upcoming`).
 *   5. When status transitions to 'confirmed', confirmed_at is stamped.
 */

let tableStates;
const { installSupabaseMock, invokeRoute, resetTableStates } = require('./_shared');

beforeEach(() => {
  jest.resetModules();
  tableStates = resetTableStates();
  installSupabaseMock(tableStates);
});
afterEach(() => jest.resetModules());

describe('PATCH /api/portal/hcp/schedules/:id', () => {
  it('requires portal auth (401)', async () => {
    const { statusCode } = await invokeRoute({
      method: 'patch', path: '/schedules/:id', userId: null,
      params: { id: 'v-1' }, body: { status: 'confirmed' },
    });
    expect(statusCode).toBe(401);
  });

  it('404 when schedule not found', async () => {
    tableStates.hcp_visit_schedules = { rows: [] };
    const { statusCode } = await invokeRoute({
      method: 'patch', path: '/schedules/:id',
      params: { id: 'v-missing' }, body: { status: 'confirmed' },
    });
    expect(statusCode).toBe(404);
  });

  it('400 on invalid target status', async () => {
    tableStates.hcp_visit_schedules = {
      rows: [{ id: 'v-1', coach_id: 'coach-1', status: 'upcoming' }],
    };
    const { statusCode } = await invokeRoute({
      method: 'patch', path: '/schedules/:id',
      params: { id: 'v-1' }, body: { status: 'nonsense' },
    });
    expect(statusCode).toBe(400);
  });

  it('409 on invalid state transition (completed -> upcoming)', async () => {
    tableStates.hcp_visit_schedules = {
      rows: [{ id: 'v-1', coach_id: 'coach-1', status: 'completed' }],
    };
    const { statusCode } = await invokeRoute({
      method: 'patch', path: '/schedules/:id',
      params: { id: 'v-1' }, body: { status: 'upcoming' },
    });
    expect(statusCode).toBe(409);
  });

  it('transitions upcoming -> confirmed and stamps confirmed_at', async () => {
    tableStates.hcp_visit_schedules = {
      rows: [{ id: 'v-1', coach_id: 'coach-1', status: 'upcoming', confirmed_at: null }],
    };
    const { statusCode, payload } = await invokeRoute({
      method: 'patch', path: '/schedules/:id',
      params: { id: 'v-1' }, body: { status: 'confirmed' },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.schedule.status).toBe('confirmed');
    expect(payload.schedule.confirmed_at).toBeTruthy();
  });
});
