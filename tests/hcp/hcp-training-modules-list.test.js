/**
 * GET /api/portal/hcp/training-modules
 *
 * Lists all active training modules the coach can browse or assign to a
 * teacher. Thin projection over the existing `training_modules` table
 * (already seeded per the NIETE migration + Beacon House content); no new
 * table is introduced (anti-sprawl rule 15).
 *
 * Access rules:
 *   1. requirePortalAuth.
 *   2. Returns only rows where is_active = true.
 *   3. Ordered by (course_id, order_index).
 */

let tableStates;
const { installSupabaseMock, invokeRoute, resetTableStates } = require('./_shared');

beforeEach(() => {
  jest.resetModules();
  tableStates = resetTableStates();
  installSupabaseMock(tableStates);
});
afterEach(() => jest.resetModules());

describe('GET /api/portal/hcp/training-modules', () => {
  it('requires portal auth (401)', async () => {
    const { statusCode } = await invokeRoute({
      method: 'get', path: '/training-modules', userId: null,
    });
    expect(statusCode).toBe(401);
  });

  it('returns only active modules', async () => {
    tableStates.training_modules = {
      rows: [
        { id: 1, title: 'Active A', course_id: 1, order_index: 1, is_active: true },
        { id: 2, title: 'Inactive', course_id: 1, order_index: 2, is_active: false },
        { id: 3, title: 'Active B', course_id: 1, order_index: 3, is_active: true },
      ],
    };

    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/training-modules',
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    const titles = payload.modules.map((m) => m.title);
    expect(titles).toEqual(expect.arrayContaining(['Active A', 'Active B']));
    expect(titles).not.toContain('Inactive');
  });

  it('returns an empty array when there are no modules', async () => {
    tableStates.training_modules = { rows: [] };
    const { statusCode, payload } = await invokeRoute({
      method: 'get', path: '/training-modules',
    });
    expect(statusCode).toBe(200);
    expect(payload.modules).toEqual([]);
  });
});
