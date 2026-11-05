'use strict';
/**
 * bd-rj6w0n.14.2 — which region a teacher is in: regionForUser(user) -> 'ict' | 'gb' | 'unknown'.
 *
 * The rule is pure (no I/O, no requires), so the bot and the teacher app's API read the same function.
 * Storage is the existing users.region column: no new table, no new column. Detection order, all zero
 * messages: users.source 'main_rumi_gb' (how the GB cohort was imported), then users.region (which the
 * GB roster seed and the teacher app's one-time choice write), then her school's schools.region.
 */

const region = () => require('../../bot/shared/services/region.service');

describe('regionForUser — the one rule', () => {
  test.each([
    ['Gilgit-Baltistan', 'gb'],
    ['gilgit_baltistan', 'gb'],
    [' gilgit baltistan ', 'gb'],
    ['GB', 'gb'],
    ['ICT', 'ict'],
    ['ict', 'ict'],
    ['Islamabad', 'ict'],
    ['federal', 'ict'],
    ['Sihala', 'ict'],
    ['Urban-I', 'ict'],
    ['Urban-II', 'ict'],
    ['Tarnol', 'ict'],
    ['Nilore', 'ict'],
    ['B.K', 'ict'],
    ['Barakahu', 'ict'],
  ])('users.region %j -> %s', (value, expected) => {
    expect(region().regionForUser({ region: value })).toBe(expected);
  });

  test.each([[null], [undefined], [''], ['   '], ['Kenya'], ['Punjab'], [42]])(
    'users.region %j -> unknown', (value) => {
      expect(region().regionForUser({ region: value })).toBe('unknown');
    });

  test("users.source 'main_rumi_gb' -> gb even with no region (how GB teachers were imported)", () => {
    expect(region().regionForUser({ source: 'main_rumi_gb', region: null })).toBe('gb');
    expect(region().regionForUser({ source: 'direct', region: null })).toBe('unknown');
  });

  test('users.region wins over the school; the school fills in when users.region is empty', () => {
    expect(region().regionForUser({ region: 'ICT', school_region: 'Gilgit-Baltistan' })).toBe('ict');
    expect(region().regionForUser({ region: null, school_region: 'Gilgit-Baltistan' })).toBe('gb');
    expect(region().regionForUser({ region: null, school_region: 'ICT' })).toBe('ict');
    expect(region().regionForUser({ region: null, source: 'direct', school_region: null })).toBe('unknown');
  });

  test('no user at all -> unknown', () => {
    expect(region().regionForUser(null)).toBe('unknown');
    expect(region().regionForUser(undefined)).toBe('unknown');
  });

  test('STORED_VALUE is the spelling users.region already holds for each region', () => {
    expect(region().STORED_VALUE).toEqual({ ict: 'ICT', gb: 'Gilgit-Baltistan' });
    expect(region().regionForUser({ region: region().STORED_VALUE.gb })).toBe('gb');
    expect(region().regionForUser({ region: region().STORED_VALUE.ict })).toBe('ict');
  });

  test('the module is pure: it requires nothing (so the teacher-app API can load it)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../../bot/shared/services/region.service'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/require\(/);
  });
});
