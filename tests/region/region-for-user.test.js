'use strict';
/**
 * bd-rj6w0n.14.2 — which region a teacher is in: regionForUser(client, user) -> 'ict' | 'gb' | 'unknown'.
 *
 * The region registry (bd-97daxo.2, region_features) is the standard: a value is GB when its row's
 * organization is 'moawin' and ICT when it is 'niete'. No list of region names lives in this code, so
 * a value the registry does not hold is 'unknown' and the teacher app asks once. Detection order, all
 * zero messages: users.source 'main_rumi_gb' (how the GB cohort was imported; the registry has no
 * source signal), then users.region, then her school's schools.region.
 */

const ROWS = [
  { region: 'b.k', organization: 'niete', display_name: 'B.K', sort_order: 1, is_active: true },
  { region: 'sihala', organization: 'niete', display_name: 'Sihala', sort_order: 2, is_active: true },
  { region: 'urban-i', organization: 'niete', display_name: 'Urban-I', sort_order: 3, is_active: true },
  { region: 'nilore', organization: 'niete', display_name: 'Nilore', sort_order: 4, is_active: true },
  { region: 'urban-ii', organization: 'niete', display_name: 'Urban-II', sort_order: 5, is_active: true },
  { region: 'tarnol', organization: 'niete', display_name: 'Tarnol', sort_order: 6, is_active: true },
  { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', sort_order: 1, is_active: true },
  { region: 'niete', organization: null, display_name: null, sort_order: null, is_active: true },
];
const client = (rows = ROWS) => ({ from: () => ({ select: async () => ({ data: rows, error: null }) }) });

let R;
beforeEach(() => {
  jest.resetModules();
  require('../../bot/shared/services/region-registry')._clearCache();
  R = require('../../bot/shared/services/region.service');
});

describe('regionForUser — the registry decides', () => {
  test.each([
    ['Gilgit-Baltistan', 'gb'], ['gilgit-baltistan', 'gb'], [' GILGIT-BALTISTAN ', 'gb'],
    ['Sihala', 'ict'], ['Urban-I', 'ict'], ['Urban-II', 'ict'], ['Tarnol', 'ict'], ['Nilore', 'ict'], ['B.K', 'ict'], ['b.k', 'ict'],
  ])('users.region %j -> %s', async (value, expected) => {
    expect(await R.regionForUser(client(), { region: value })).toBe(expected);
  });

  test.each([[null], [undefined], [''], ['   '], ['GB'], ['ICT'], ['Islamabad'], ['niete'], ['Kenya'], [42]])(
    'users.region %j is not a registry region -> unknown', async (value) => {
      expect(await R.regionForUser(client(), { region: value })).toBe('unknown');
    });

  test('a new registry row is a region without a release', async () => {
    const rows = [...ROWS, { region: 'hunza', organization: 'moawin', display_name: 'Hunza', sort_order: 2, is_active: true }];
    expect(await R.regionForUser(client(rows), { region: 'Hunza' })).toBe('gb');
  });

  test("users.source 'main_rumi_gb' -> gb even with no region (how GB teachers were imported)", async () => {
    expect(await R.regionForUser(client(), { source: 'main_rumi_gb', region: null })).toBe('gb');
    expect(await R.regionForUser(client(), { source: 'direct', region: null })).toBe('unknown');
  });

  test('users.region wins over the school; the school fills in when users.region is not a region', async () => {
    expect(await R.regionForUser(client(), { region: 'Sihala', school_region: 'Gilgit-Baltistan' })).toBe('ict');
    expect(await R.regionForUser(client(), { region: null, school_region: 'Gilgit-Baltistan' })).toBe('gb');
    expect(await R.regionForUser(client(), { region: null, school_region: 'Tarnol' })).toBe('ict');
    expect(await R.regionForUser(client(), { region: null, school_region: null })).toBe('unknown');
  });

  test('no user at all -> unknown', async () => {
    expect(await R.regionForUser(client(), null)).toBe('unknown');
  });

  test('an unreadable registry throws (it fails closed); the caller decides', async () => {
    const broken = { from: () => ({ select: async () => ({ data: null, error: { message: 'down' } }) }) };
    await expect(R.regionForUser(broken, { region: 'Sihala' })).rejects.toThrow(/registry/);
  });
});

describe('regionsFor — the spellings users.region may hold, from the registry', () => {
  test('ict = the niete sectors in dashboard order; gb = the moawin regions', async () => {
    expect(await R.regionsFor(client(), 'ict')).toEqual(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol']);
    expect(await R.regionsFor(client(), 'gb')).toEqual(['Gilgit-Baltistan']);
    expect(await R.regionsFor(client(), 'kenya')).toEqual([]);
  });

  test('the module holds no region names of its own', () => {
    const src = require('fs').readFileSync(require.resolve('../../bot/shared/services/region.service'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/gilgit|sihala|tarnol|islamabad|'ICT'/i);
  });
});
