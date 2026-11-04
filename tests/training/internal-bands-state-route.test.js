'use strict';
/**
 * The portal's one path to a teacher's training level:
 *   POST /api/internal/training/bands/state
 *
 * On 15 Sep 2026 the helper this route calls was imported INSIDE a doc comment,
 * so the require never ran and every teacher who opened their training level got
 * a 500 ("teacherLevelOf is not defined"). A source grep would have passed — the
 * line was there. This test executes the real route handler, with the database
 * and the band service mocked at their boundary.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/training/band-selection.service', () => ({
  BANDS: [{ key: 'PRIMARY', label: 'Primary' }, { key: 'MIDDLE', label: 'Middle' }, { key: 'HIGH', label: 'High' }],
  canChangeBands: jest.fn(() => ({ allowed: true, isFirstSelection: false, hoursRemaining: 0 })),
  changeWarning: jest.fn(() => 'Changing your level reassigns your training.'),
}));

const supabase = require('../../bot/shared/config/supabase');
const { logToFile } = require('../../bot/shared/utils/logger');
const router = require('../../bot/shared/routes/internal-api.routes');

/** The last handler on a route, i.e. the route body behind its auth middleware. */
function routeBody(method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`no ${method.toUpperCase()} ${path} on the internal router`);
  const { stack } = layer.route;
  return stack[stack.length - 1].handle;
}

function response() {
  const r = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  return r;
}

beforeEach(() => jest.clearAllMocks());

test('returns the teacher\'s level, read through teacherLevelOf, instead of failing', async () => {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    single: jest.fn().mockResolvedValue({
      data: { teacher_level: ['middle', 'PRIMARY'], teacher_level_updated_at: null }, error: null,
    }),
  };
  supabase.from.mockReturnValue(chain);
  const res = response();

  await routeBody('post', '/training/bands/state')({ body: { userId: 'u-1' }, headers: {} }, res);

  const failed = logToFile.mock.calls.find((c) => /Internal bands API failed/.test(c[0]));
  expect(failed ? failed[1] : null).toBeNull();
  expect(res.status).not.toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    success: true,
    selected: ['PRIMARY', 'MIDDLE'],           // canonical order, lower-case tolerated
    can_change: true,
  }));
  expect(supabase.from).toHaveBeenCalledWith('users');
  expect(chain.select).toHaveBeenCalledWith('teacher_level, teacher_level_updated_at');
});
