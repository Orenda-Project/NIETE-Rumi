/**
 * Live moves (bd-v0toag.31): who gets the live list. app_settings.live_moves =
 * { enabled, school_ids }; on only for group D teachers in a listed school while enabled.
 * Fail closed: no row, a read error or any other group is off.
 */
jest.mock('../../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn() }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { liveMovesOn, _resetCache } = require('../../../bot/shared/services/coaching/live-moves/switch');

const USER = 'u-1';
const SCHOOL = 's-1';

function deps({ setting = { enabled: true, school_ids: [SCHOOL] }, settingError = null,
  school = SCHOOL, group = 'D' } = {}) {
  const tables = {
    app_settings: { data: setting === null ? null : { key: 'live_moves', value: setting }, error: settingError },
    users: { data: { id: USER, school_id: school }, error: null },
  };
  const supabase = {
    from: jest.fn((t) => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => tables[t] };
      return chain;
    }),
  };
  return { supabase, groupFor: jest.fn(async () => (group ? { group } : null)), log: jest.fn() };
}

beforeEach(() => _resetCache());

describe('liveMovesOn', () => {
  test('off when no row', async () => {
    expect(await liveMovesOn(USER, deps({ setting: null }))).toBe(false);
  });

  test('off when enabled false even if school listed', async () => {
    expect(await liveMovesOn(USER, deps({ setting: { enabled: false, school_ids: [SCHOOL] } }))).toBe(false);
  });

  test('off when school not listed', async () => {
    expect(await liveMovesOn(USER, deps({ school: 's-other' }))).toBe(false);
  });

  test('off when group is B', async () => {
    expect(await liveMovesOn(USER, deps({ group: 'B' }))).toBe(false);
  });

  test('on for D + listed + enabled', async () => {
    expect(await liveMovesOn(USER, deps())).toBe(true);
  });

  test('on when the setting value is stored as a JSON string', async () => {
    expect(await liveMovesOn(USER, deps({ setting: JSON.stringify({ enabled: true, school_ids: [SCHOOL] }) }))).toBe(true);
  });

  test('off when supabase errors', async () => {
    const d = deps({ settingError: { message: 'boom' } });
    expect(await liveMovesOn(USER, d)).toBe(false);
    expect(d.log).toHaveBeenCalled();
  });

  test('off for an empty user id', async () => {
    const d = deps();
    expect(await liveMovesOn('', d)).toBe(false);
    expect(d.supabase.from).not.toHaveBeenCalled();
  });

  test('caches the setting for 60 s', async () => {
    const d = deps();
    let t = 0;
    d.now = () => t;
    await liveMovesOn(USER, d);
    t += 59 * 1000;
    await liveMovesOn(USER, d);
    const settingReads = () => d.supabase.from.mock.calls.filter(([x]) => x === 'app_settings').length;
    expect(settingReads()).toBe(1);
    t += 2 * 1000;
    await liveMovesOn(USER, d);
    expect(settingReads()).toBe(2);
  });
});
