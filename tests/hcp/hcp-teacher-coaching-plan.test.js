/**
 * GET /api/portal/hcp/teachers/:id/coaching-plan
 *
 * Per-indicator coaching action plan for one teacher — matches each weak
 * indicator against rows in `hcp_coaching_actions` and returns pairs of
 * (indicator_code, action_text). The coach uses this as a starting checklist
 * during their next visit.
 *
 * Access rules:
 *   1. requirePortalAuth.
 *   2. 404 when the teacher does not exist.
 *   3. Returns `{ teacher, plan: [{ indicator_code, avg_score_pct, actions: [...] }] }`.
 *      One entry per weak indicator; `actions` may be empty if the reference
 *      table has no rows for that code.
 */

let tableStates;
const { installSupabaseMock, invokeRoute, resetTableStates } = require('./_shared');

beforeEach(() => {
  jest.resetModules();
  tableStates = resetTableStates();
  installSupabaseMock(tableStates);
});
afterEach(() => jest.resetModules());

describe('GET /api/portal/hcp/teachers/:id/coaching-plan', () => {
  it('requires portal auth (401)', async () => {
    const { statusCode } = await invokeRoute({
      method: 'get', path: '/teachers/:id/coaching-plan', userId: null, params: { id: 't-1' },
    });
    expect(statusCode).toBe(401);
  });

  it('404 when teacher not found', async () => {
    tableStates.users = { rows: [] };
    const { statusCode } = await invokeRoute({
      method: 'get', path: '/teachers/:id/coaching-plan', params: { id: 't-missing' },
    });
    expect(statusCode).toBe(404);
  });

  it('returns per-weak-indicator action plan', async () => {
    tableStates.users = { rows: [{ id: 't-1', first_name: 'Aisha', region: 'ICT' }] };
    tableStates.coaching_sessions = {
      rows: [{
        id: 's-1', user_id: 't-1',
        analysis_data: { overall_score: 0.4, indicators: [
          { code: 'PIC-4', score: 0.3 }, { code: 'L2', score: 0.4 }, { code: 'SI1', score: 0.9 },
        ] },
      }],
    };
    tableStates.hcp_coaching_actions = {
      rows: [
        { id: 1, indicator_code: 'PIC-4', action_text: 'Ask more open questions.', priority_order: 1 },
        { id: 2, indicator_code: 'L2', action_text: 'Name one comprehension strategy.', priority_order: 1 },
        { id: 3, indicator_code: 'SI1', action_text: 'Not applicable — not weak.', priority_order: 1 },
      ],
    };

    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/teachers/:id/coaching-plan', params: { id: 't-1' },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    const codes = payload.plan.map((p) => p.indicator_code);
    expect(codes).toEqual(expect.arrayContaining(['PIC-4', 'L2']));
    expect(codes).not.toContain('SI1');
    const pic4 = payload.plan.find((p) => p.indicator_code === 'PIC-4');
    expect(pic4.actions[0].action_text).toBe('Ask more open questions.');
  });

  it('handles indicators with no matching actions gracefully', async () => {
    tableStates.users = { rows: [{ id: 't-1', first_name: 'A', region: 'ICT' }] };
    tableStates.coaching_sessions = {
      rows: [{ id: 's-1', user_id: 't-1', analysis_data: { indicators: [
        { code: 'UNKNOWN-CODE', score: 0.2 },
      ] } }],
    };
    tableStates.hcp_coaching_actions = { rows: [] };

    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/teachers/:id/coaching-plan', params: { id: 't-1' },
    });

    expect(statusCode).toBe(200);
    const uk = payload.plan.find((p) => p.indicator_code === 'UNKNOWN-CODE');
    expect(uk.actions).toEqual([]);
  });
});
