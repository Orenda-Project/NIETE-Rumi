'use strict';
/**
 * Which region a child-test draw row is stamped with. Every draw was written `region: 'ict'`, so a Gilgit-Baltistan
 * school's children would have been counted as ICT's. The row now carries the region of the SCHOOL it is drawn at:
 * schools.region, named through the region registry (region_features: the owning organization).
 *
 *   an ICT sector (organization niete)          'ict', exactly as every draw before (no ICT row changes)
 *   another programme (Gilgit-Baltistan, moawin) its registry key, 'gilgit-baltistan'
 *   a region the registry does not list, a blank region, or a registry that cannot be read   'ict' (today's value)
 *
 * The frame (todaysList) and a child added on the spot (addChild) both carry it. Only the Supabase client is replaced.
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('./helpers/fake-supabase');
const { buildRoster } = require('./helpers/roster');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const NOW = new Date('2026-11-26T05:00:00Z');
const KID = '0a0a0a0a-0000-4000-8000-0000000000a1';
const REGISTRY = [
  { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', is_active: true },
  { region: 'urban', organization: 'niete', display_name: 'Urban', is_active: true },
  { region: 'sihala', organization: 'niete', display_name: 'Sihala', is_active: true },
  { region: 'niete', organization: null, display_name: null, is_active: true }, // the deployment-wide LP row
];

let draw;
function setup({ schoolRegion, registry = REGISTRY, classes = [{ id: 'g3a', grade: 3, section: 'A', size: 12 }] } = {}) {
  const tables = buildRoster({ classes });
  tables.schools[0].region = schoolRegion;
  tables.region_features = registry.map((r) => ({ ...r }));
  mockFake = createFakeSupabase(tables, { unique: CHILD_TEST_UNIQUE });
  jest.resetModules();
  draw = require('../../../bot/shared/services/child-test/draw');
  return mockFake;
}
const T = () => mockFake.__tables;
const list = () => draw.todaysList({ coachUserId: 'coach-1', schoolId: 'school-1', visitId: 'visit-1', observedGrade: 3, now: NOW });
const regions = () => [...new Set(T().child_test_draws.map((d) => d.region))];

beforeEach(() => { process.env.CHILD_TEST_DRAW_SECRET = 'test-secret'; process.env.CHILD_TEST_FORM_POLICY = 'returning_b'; });
afterAll(() => { delete process.env.CHILD_TEST_DRAW_SECRET; delete process.env.CHILD_TEST_FORM_POLICY; });

describe('the frame is stamped with the school\'s region', () => {
  test('RED on the base: a Gilgit-Baltistan school → gilgit-baltistan', async () => {
    setup({ schoolRegion: 'Gilgit-Baltistan' });
    expect((await list()).ok).toBe(true);
    expect(T().child_test_draws).toHaveLength(12);
    expect(regions()).toEqual(['gilgit-baltistan']);
  });

  test.each(['Urban', 'Sihala', 'sihala '])('an ICT sector (%s) → ict, as before', async (value) => {
    setup({ schoolRegion: value });
    await list();
    expect(regions()).toEqual(['ict']);
  });

  test.each([['a region the registry does not list', 'ict'], ['a blank region', ''], ['no region', null]])('%s → ict', async (_label, value) => {
    setup({ schoolRegion: value });
    await list();
    expect(regions()).toEqual(['ict']);
  });

  test('a registry that cannot be read → ict, and the list is still drawn', async () => {
    setup({ schoolRegion: 'Gilgit-Baltistan' });
    mockFake.__failNext({ message: 'boom' }, 'region_features');
    expect((await list()).ok).toBe(true);
    expect(regions()).toEqual(['ict']);
  });
});

describe('a child added on the spot is stamped the same way', () => {
  test('RED on the base: added at a Gilgit-Baltistan school → gilgit-baltistan', async () => {
    setup({ schoolRegion: 'Gilgit-Baltistan' });
    await list();
    const r = await draw.addChild({ schoolId: 'school-1', visitId: 'visit-1', grade: 3, firstName: 'Zara', section: 'A', clientChildId: KID, now: NOW });
    expect(r.ok).toBe(true);
    expect(T().child_test_draws.find((d) => d.student_id === KID).region).toBe('gilgit-baltistan');
  });

  test('added at an ICT school → ict', async () => {
    setup({ schoolRegion: 'Urban' });
    await list();
    await draw.addChild({ schoolId: 'school-1', visitId: 'visit-1', grade: 3, firstName: 'Zara', section: 'A', clientChildId: KID, now: NOW });
    expect(T().child_test_draws.find((d) => d.student_id === KID).region).toBe('ict');
  });
});
