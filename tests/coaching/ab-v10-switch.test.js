/**
 * The v10 coaching test's master switch: app_settings.ab_v10_enabled.
 * Everything the test adds reads this, so with it off prod behaves as before.
 * Fail closed: missing row, junk value or a read error all mean off.
 */
const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const sw = require('../../bot/shared/services/coaching/ab-v10-switch');

function row(result) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => result),
  };
  mockSupabase.from.mockImplementation(() => chain);
  return chain;
}

beforeEach(() => { jest.clearAllMocks(); sw._resetCache(); });

describe('ab_v10_enabled', () => {
  test('reads the ab_v10_enabled key', async () => {
    const chain = row({ data: { key: 'ab_v10_enabled', value: 'true' }, error: null });
    expect(await sw.v10Enabled()).toBe(true);
    expect(mockSupabase.from).toHaveBeenCalledWith('app_settings');
    expect(chain.eq).toHaveBeenCalledWith('key', 'ab_v10_enabled');
  });

  test.each([['true', true], ['"true"', true], [true, true], [' TRUE ', true],
    ['false', false], [false, false], ['yes', false], ['1', false], [null, false]])(
    'value %p → %p', async (value, expected) => {
      row({ data: { key: 'ab_v10_enabled', value }, error: null });
      expect(await sw.v10Enabled()).toBe(expected);
    });

  test('no row means off', async () => {
    row({ data: null, error: null });
    expect(await sw.v10Enabled()).toBe(false);
  });

  test('a read error means off, and is not cached', async () => {
    row({ data: null, error: { message: 'boom' } });
    expect(await sw.v10Enabled()).toBe(false);
    row({ data: { key: 'ab_v10_enabled', value: 'true' }, error: null });
    expect(await sw.v10Enabled()).toBe(true);
  });

  test('a thrown read means off', async () => {
    mockSupabase.from.mockImplementation(() => { throw new Error('network'); });
    expect(await sw.v10Enabled()).toBe(false);
  });

  test('a good read is cached for 30 seconds, then read again', async () => {
    row({ data: { key: 'ab_v10_enabled', value: 'true' }, error: null });
    expect(await sw.v10Enabled(1000)).toBe(true);
    row({ data: { key: 'ab_v10_enabled', value: 'false' }, error: null });
    expect(await sw.v10Enabled(1000 + 29999)).toBe(true);
    expect(await sw.v10Enabled(1000 + 30000)).toBe(false);
  });
});
