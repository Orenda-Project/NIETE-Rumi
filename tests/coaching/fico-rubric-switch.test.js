'use strict';
/**
 * bd-ra8xu.38 — the two FICO rubric switches (coach: current|v6, DC: v3|shadow|v6), per region, default OFF.
 */

global.__ROWS = [];
global.__ERR = null;
jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    in: jest.fn(() => Promise.resolve(global.__ERR ? { data: null, error: { message: global.__ERR } } : { data: global.__ROWS, error: null })),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { region: 'Sihala' }, error: null })),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/region-registry', () => ({
  organizationForRegion: jest.fn((client, region) => Promise.resolve(
    ({ sihala: 'niete', tarnol: 'niete', 'gilgit-baltistan': 'moawin' })[String(region || '').toLowerCase()] || null,
  )),
}));

const sw = require('../../bot/shared/services/coaching/fico-rubric-switch');

const { asMap, resolve, COACH_VALUES, DC_VALUES } = sw;
const USER = '11111111-2222-4333-8444-555555555555';

beforeEach(() => { sw._resetCache(); global.__ROWS = []; global.__ERR = null; });

describe('resolve (pure)', () => {
  test('no row → off', () => {
    expect(resolve(asMap(undefined), { region: 'Sihala' }, COACH_VALUES, 'current')).toBe('current');
    expect(resolve(asMap(null), { region: 'Sihala' }, DC_VALUES, 'v3')).toBe('v3');
  });
  test('a plain string applies to every region', () => {
    expect(resolve(asMap('v6'), { region: 'Tarnol' }, COACH_VALUES, 'current')).toBe('v6');
    expect(resolve(asMap('"shadow"'), {}, DC_VALUES, 'v3')).toBe('shadow');
  });
  test('"*" is the wildcard; a region key beats it', () => {
    const m = asMap('{"*":"current","sihala":"v6"}');
    expect(resolve(m, { region: 'Sihala' }, COACH_VALUES, 'current')).toBe('v6');
    expect(resolve(m, { region: 'Tarnol' }, COACH_VALUES, 'current')).toBe('current');
  });
  test('region beats organization; ict/gb aliases name the organizations', () => {
    const m = asMap({ ict: 'shadow', sihala: 'v3', gb: 'v6' });
    expect(resolve(m, { region: 'Sihala', organization: 'niete' }, DC_VALUES, 'v3')).toBe('v3');
    expect(resolve(m, { region: 'Tarnol', organization: 'niete' }, DC_VALUES, 'v3')).toBe('shadow');
    expect(resolve(m, { region: 'Gilgit-Baltistan', organization: 'moawin' }, DC_VALUES, 'v3')).toBe('v6');
  });
  test('a "user:<id>" key beats region, organization and "*"', () => {
    const m = asMap({ [`user:${USER}`]: 'v6', sihala: 'current', '*': 'current' });
    expect(resolve(m, { userId: USER, region: 'Sihala', organization: 'niete' }, COACH_VALUES, 'current')).toBe('v6');
    expect(resolve(m, { userId: 'someone-else', region: 'Sihala' }, COACH_VALUES, 'current')).toBe('current');
  });
  test('an unknown value is off, not passed through', () => {
    expect(resolve(asMap('bogus'), {}, DC_VALUES, 'v3')).toBe('v3');
    expect(resolve(asMap({ sihala: 'v5' }), { region: 'Sihala' }, COACH_VALUES, 'current')).toBe('current');
    expect(resolve(asMap('[1,2]'), {}, COACH_VALUES, 'current')).toBe('current');
  });
});

describe('coachRubric / dcRubric read app_settings', () => {
  test('no rows → current / v3', async () => {
    await expect(sw.coachRubric({ userId: USER, region: 'Sihala' })).resolves.toBe('current');
    await expect(sw.dcRubric({ userId: USER, region: 'Sihala' })).resolves.toBe('v3');
  });
  test('rows per key, with the organization looked up for an ict key', async () => {
    global.__ROWS = [
      { key: 'fico_coach_rubric', value: '{"ict":"v6"}' },
      { key: 'fico_dc_rubric', value: { [`user:${USER}`]: 'shadow' } },
    ];
    await expect(sw.coachRubric({ region: 'Tarnol' })).resolves.toBe('v6');
    await expect(sw.coachRubric({ region: 'Gilgit-Baltistan' })).resolves.toBe('current');
    await expect(sw.dcRubric({ userId: USER, region: 'Tarnol' })).resolves.toBe('shadow');
    await expect(sw.dcRubric({ userId: 'other', region: 'Tarnol' })).resolves.toBe('v3');
  });
  test('a failed read is off and never throws', async () => {
    global.__ERR = 'boom';
    await expect(sw.coachRubric({ region: 'Sihala' })).resolves.toBe('current');
    await expect(sw.dcRubric({ region: 'Sihala' })).resolves.toBe('v3');
  });
});
