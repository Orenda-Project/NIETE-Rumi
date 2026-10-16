'use strict';
/**
 * bd-v0toag.32 — the weekly report's own switch and template approval list, both in app_settings, read the
 * way ab_v10_enabled is read: fail closed, 30 s cache, a failed read is not cached. Supabase is the boundary.
 */

const mockFrom = jest.fn();
jest.mock('../../../shared/config/supabase', () => ({ from: (...a) => mockFrom(...a) }));
const mockLog = jest.fn();
jest.mock('../../../shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));

const sw = require('../../../shared/services/coaching/weekly-report/switch');

function settings(result) {
  const calls = [];
  const q = {
    select: (c) => { calls.push(['select', c]); return q; },
    in: (col, v) => { calls.push(['in', col, v]); return Promise.resolve(result); },
  };
  mockFrom.mockImplementation((t) => { calls.push(['from', t]); return q; });
  return calls;
}

beforeEach(() => { jest.clearAllMocks(); sw._resetCache(); });

test('the keys', () => {
  expect(sw.FLAG_KEY).toBe('v10_weekly_report_enabled');
  expect(sw.TEMPLATES_KEY).toBe('v10_weekly_report_templates');
});

test('reads both keys from app_settings in one narrow select', async () => {
  const calls = settings({ data: [], error: null });
  await sw.reportSettings(0);
  expect(calls).toEqual([
    ['from', 'app_settings'],
    ['select', 'key,value'],
    ['in', 'key', ['v10_weekly_report_enabled', 'v10_weekly_report_templates']],
  ]);
});

test.each([
  [true, true], ['true', true], ['"true"', true], [' TRUE ', true],
  [false, false], ['false', false], [null, false], [1, false], ['yes', false],
])('enabled when the value is %p → %p', async (value, on) => {
  settings({ data: [{ key: 'v10_weekly_report_enabled', value }], error: null });
  expect((await sw.reportSettings(0)).enabled).toBe(on);
});

test('no row at all is off, with no approved templates', async () => {
  settings({ data: [], error: null });
  expect(await sw.reportSettings(0)).toEqual({ enabled: false, approved: [] });
});

test.each([
  [['weekly_usage_v1', 'weekly_usage_quiet_v1'], ['weekly_usage_v1', 'weekly_usage_quiet_v1']],
  ['["weekly_usage_v1"]', ['weekly_usage_v1']],
  ['weekly_usage_v1', []], // not a list: nothing is approved
  [[1, 'weekly_usage_v1', ''], ['weekly_usage_v1']],
])('approved templates from %p', async (value, approved) => {
  settings({ data: [{ key: 'v10_weekly_report_templates', value }], error: null });
  expect((await sw.reportSettings(0)).approved).toEqual(approved);
});

test('a read error is off, logged at error level, and not cached', async () => {
  settings({ data: null, error: { message: 'boom' } });
  expect(await sw.reportSettings(0)).toEqual({ enabled: false, approved: [] });
  expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('weekly report'), expect.objectContaining({ error: 'boom' }), 'error');
  settings({ data: [{ key: 'v10_weekly_report_enabled', value: true }], error: null });
  expect((await sw.reportSettings(1)).enabled).toBe(true);
});

test('cached for 30 s, then read again', async () => {
  settings({ data: [{ key: 'v10_weekly_report_enabled', value: true }], error: null });
  await sw.reportSettings(0);
  await sw.reportSettings(29999);
  expect(mockFrom).toHaveBeenCalledTimes(1);
  await sw.reportSettings(30000);
  expect(mockFrom).toHaveBeenCalledTimes(2);
});
