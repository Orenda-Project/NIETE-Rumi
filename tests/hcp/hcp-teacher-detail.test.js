/**
 * GET /api/portal/hcp/teachers/:id
 *
 * Returns the teacher-detail payload the coach sees when tapping a teacher
 * on the Priority Dashboard. Same base identity as the /teachers list, plus
 * a small DC summary (avg score, session count, first/last session, weak
 * indicator count) and the teacher's most-recent visit schedule (if any).
 *
 * Access rules:
 *   1. requirePortalAuth (401 without a session).
 *   2. 404 when the teacher id does not exist.
 *   3. Zero-session teachers return session_count=0, avg_dc_score_pct=null.
 */

let tableStates;
const { installSupabaseMock, invokeRoute, resetTableStates } = require('./_shared');

beforeEach(() => {
  jest.resetModules();
  tableStates = resetTableStates();
  installSupabaseMock(tableStates);
});
afterEach(() => jest.resetModules());

describe('GET /api/portal/hcp/teachers/:id', () => {
  it('requires portal auth (401 when unauthenticated)', async () => {
    const { statusCode } = await invokeRoute({
      method: 'get', path: '/teachers/:id', userId: null, params: { id: 't-1' },
    });
    expect(statusCode).toBe(401);
  });

  it('returns 404 when the teacher id does not exist', async () => {
    tableStates.users = { rows: [] };
    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/teachers/:id', params: { id: 't-missing' },
    });
    expect(statusCode).toBe(404);
    expect(payload.success).toBe(false);
  });

  it('returns teacher detail with DC summary', async () => {
    tableStates.users = {
      rows: [{
        id: 't-1', first_name: 'Aisha', last_name: 'Khan',
        phone_number: '92300111', school_name: 'IMSG H-9', region: 'ICT',
      }],
    };
    tableStates.coaching_sessions = {
      rows: [
        { id: 's-1', user_id: 't-1', created_at: '2026-07-10T00:00:00Z',
          analysis_data: { overall_score: 0.42, indicators: [
            { code: 'PIC-4', score: 0.3 }, { code: 'SI1', score: 0.5 },
          ] } },
        { id: 's-2', user_id: 't-1', created_at: '2026-07-13T00:00:00Z',
          analysis_data: { overall_score: 0.48, indicators: [
            { code: 'PIC-4', score: 0.4 }, { code: 'SI1', score: 0.55 },
          ] } },
      ],
    };
    tableStates.hcp_visit_schedules = { rows: [] };

    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/teachers/:id', params: { id: 't-1' },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.teacher.id).toBe('t-1');
    expect(payload.summary.session_count).toBe(2);
    expect(payload.summary.avg_dc_score_pct).toBe(45);
    expect(payload.summary.last_session_at).toBe('2026-07-13T00:00:00Z');
  });

  it('returns zero-session teacher without erroring', async () => {
    tableStates.users = {
      rows: [{ id: 't-new', first_name: 'New', region: 'ICT' }],
    };
    tableStates.coaching_sessions = { rows: [] };
    tableStates.hcp_visit_schedules = { rows: [] };

    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/teachers/:id', params: { id: 't-new' },
    });
    expect(statusCode).toBe(200);
    expect(payload.summary.session_count).toBe(0);
    expect(payload.summary.avg_dc_score_pct).toBeNull();
  });
});
