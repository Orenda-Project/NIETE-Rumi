'use strict';
/**
 * The children's web game (switch sa_game) keeps a run as a child-test draw + session when the database has the
 * self-run columns (sa-game/store-adapter.js createRun, the child_test path). That draw row was written with region
 * 'ict' whatever the school. It now carries the school's region the same way the coach's draw does
 * (child-test/draw/region.js): an ICT sector 'ict', Gilgit-Baltistan 'gilgit-baltistan', unknown 'ict'.
 *
 * The real store adapter on the in-memory tables; only the Supabase client is replaced.
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const REGISTRY = [
  { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', is_active: true },
  { region: 'urban', organization: 'niete', display_name: 'Urban', is_active: true },
];

let Store;
function setup(schoolRegion) {
  mockFake = createFakeSupabase({
    schools: [{ id: 'sch-1', name: 'A School', region: schoolRegion, is_active: true }],
    students: [{ id: 'stu-1', school_id: 'sch-1', class_id: 'cls-1' }],
    region_features: REGISTRY.map((r) => ({ ...r })),
    child_test_draws: [], child_test_sessions: [], child_test_sa_results: [], child_test_sa_events: [],
  }, { unique: CHILD_TEST_UNIQUE });
  jest.resetModules();
  Store = require('../../../bot/shared/services/sa-game/store-adapter');
}
const run = () => Store.createRun({ id: 'run-1', drawId: 'draw-1', studentId: 'stu-1', grade: 3, lang: 'ur', part: 'tower', form: 'A', n: 1, day: '2026-11-26' });
const drawRow = () => mockFake.__tables.child_test_draws.find((d) => d.id === 'draw-1');

describe('a web game run kept as a child-test draw', () => {
  test('RED on the head before this fix: at a Gilgit-Baltistan school the draw row is Gilgit-Baltistan\'s', async () => {
    setup('Gilgit-Baltistan');
    expect(await run()).toMatchObject({ ok: true, mode: 'child_test' });
    expect(drawRow()).toMatchObject({ region: 'gilgit-baltistan', sample_role: 'self', school_id: 'sch-1' });
  });

  test.each([['an ICT sector', 'Urban'], ['a region the registry does not list', 'ict'], ['no region', null]])('%s → ict, as before', async (_l, region) => {
    setup(region);
    expect(await run()).toMatchObject({ ok: true, mode: 'child_test' });
    expect(drawRow().region).toBe('ict');
  });
});
