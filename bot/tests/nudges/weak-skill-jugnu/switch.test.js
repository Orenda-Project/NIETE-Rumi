'use strict';
/**
 * bd-ptl6x9.7 — the weak-skill nudge's own switch, approved-template list and audience, in app_settings.
 * Fail closed: no row, a bad value or a failed read is off; the audience is test accounts unless it says 'all'.
 */
const mockFrom = jest.fn();
jest.mock('../../../shared/config/supabase', () => ({ from: (...a) => mockFrom(...a) }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const sw = require('../../../shared/services/nudges/weak-skill-jugnu/switch');

function settings(result) {
  const q = { select: () => q, in: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)) };
  mockFrom.mockImplementation(() => q);
}
const row = (key, value) => ({ key, value });

beforeEach(() => { jest.clearAllMocks(); sw._resetCache(); });

test('the keys', () => {
  expect([sw.FLAG_KEY, sw.TEMPLATES_KEY, sw.AUDIENCE_KEY])
    .toEqual(['weak_skill_jugnu_enabled', 'weak_skill_jugnu_templates', 'weak_skill_jugnu_audience']);
});

test('no rows → off, nothing approved, test accounts only', async () => {
  settings({ data: [], error: null });
  expect(await sw.nudgeSettings(0)).toEqual({ enabled: false, approved: [], testOnly: true });
});

test.each([[true, true], ['true', true], ['false', false], [1, false], ['yes', false]])('enabled %p → %p', async (v, on) => {
  settings({ data: [row(sw.FLAG_KEY, v)], error: null });
  expect((await sw.nudgeSettings(0)).enabled).toBe(on);
});

test('the approved list keeps names only', async () => {
  settings({ data: [row(sw.TEMPLATES_KEY, '["weak_skill_jugnu_v1", 3, ""]')], error: null });
  expect((await sw.nudgeSettings(0)).approved).toEqual(['weak_skill_jugnu_v1']);
});

test.each([['all', false], ['"all"', false], ['test', true], ['everyone', true], [null, true]])('audience %p → testOnly %p', async (v, t) => {
  settings({ data: [row(sw.AUDIENCE_KEY, v)], error: null });
  expect((await sw.nudgeSettings(0)).testOnly).toBe(t);
});

test('a failed read is off', async () => {
  settings({ data: null, error: { message: 'boom' } });
  expect((await sw.nudgeSettings(0)).enabled).toBe(false);
});
