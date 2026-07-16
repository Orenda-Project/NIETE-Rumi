/**
 * GET /api/portal/hcp/teachers/:id/training
 *
 * Training-module recommendations for one teacher. The coach uses this to
 * assign follow-up training to the teacher based on their DC weak indicators.
 *
 * Recommendation logic (ported from HCP):
 *   1. Compute the teacher's weak indicator codes (avg_score < 0.55 across
 *      coaching_sessions.analysis_data).
 *   2. Return training_modules whose `title` OR `content_html` mentions any
 *      weak-indicator code. When there are no weak indicators, return all
 *      active modules (baseline recommendation).
 *
 * Access rules:
 *   1. requirePortalAuth.
 *   2. 404 when the teacher does not exist.
 *   3. Returns `{ teacher, weak_indicators, modules }`.
 */

let tableStates;
const { installSupabaseMock, invokeRoute, resetTableStates } = require('./_shared');

beforeEach(() => {
  jest.resetModules();
  tableStates = resetTableStates();
  installSupabaseMock(tableStates);
});
afterEach(() => jest.resetModules());

describe('GET /api/portal/hcp/teachers/:id/training', () => {
  it('requires portal auth (401 when unauthenticated)', async () => {
    const { statusCode } = await invokeRoute({
      method: 'get', path: '/teachers/:id/training', userId: null, params: { id: 't-1' },
    });
    expect(statusCode).toBe(401);
  });

  it('404 when teacher not found', async () => {
    tableStates.users = { rows: [] };
    const { statusCode } = await invokeRoute({
      method: 'get', path: '/teachers/:id/training', params: { id: 't-missing' },
    });
    expect(statusCode).toBe(404);
  });

  it('returns weak-indicator-matched modules for a teacher with weak areas', async () => {
    tableStates.users = { rows: [{ id: 't-1', first_name: 'Aisha', region: 'ICT' }] };
    tableStates.coaching_sessions = {
      rows: [
        { id: 's-1', user_id: 't-1', analysis_data: { overall_score: 0.4, indicators: [
          { code: 'PIC-4', score: 0.3 }, { code: 'L2', score: 0.4 }, { code: 'SI1', score: 0.7 },
        ] } },
      ],
    };
    tableStates.training_modules = {
      rows: [
        { id: 1, title: 'Quality Questioning (PIC-4)', content_html: '', is_active: true, course_id: 1, order_index: 1 },
        { id: 2, title: 'Comprehension Strategy Instruction (L2)', content_html: '', is_active: true, course_id: 1, order_index: 2 },
        { id: 3, title: 'Classroom Layout', content_html: '', is_active: true, course_id: 1, order_index: 3 },
      ],
    };

    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/teachers/:id/training', params: { id: 't-1' },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.weak_indicators).toEqual(expect.arrayContaining(['PIC-4', 'L2']));
    const ids = payload.modules.map((m) => m.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).not.toContain(3);
  });

  it('returns all active modules when the teacher has no weak indicators', async () => {
    tableStates.users = { rows: [{ id: 't-2', first_name: 'Bilal', region: 'ICT' }] };
    tableStates.coaching_sessions = { rows: [] };
    tableStates.training_modules = {
      rows: [
        { id: 1, title: 'Module A', content_html: '', is_active: true, course_id: 1, order_index: 1 },
        { id: 2, title: 'Module B', content_html: '', is_active: true, course_id: 1, order_index: 2 },
      ],
    };

    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/teachers/:id/training', params: { id: 't-2' },
    });

    expect(statusCode).toBe(200);
    expect(payload.weak_indicators).toEqual([]);
    expect(payload.modules).toHaveLength(2);
  });
});
