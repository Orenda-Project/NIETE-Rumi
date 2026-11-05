/**
 * G6-12 contract 1 §5: the bot's isFlagEnabledForUser (bot/shared/config/feature-flags.js) and the
 * dashboard's (dashboard/lib/feature-flags.js) answer the same boolean for the same app_settings row
 * and user. One documented divergence: "teachers" needs a users read on the dashboard; the bot
 * answers false for it (fail closed, no users read).
 */
let mockCurrent;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockCurrent.from(t) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const bot = require('../../bot/shared/config/feature-flags');
const dash = require('../../dashboard/lib/feature-flags');

const KEY = 'assessment_grades_6_12';
const ABSENT = Symbol('absent');
const ERROR = Symbol('error');
const THROW = Symbol('throw');

/** A fresh client per case (the dashboard caches rows per client). */
function fakeDb(value, users = {}) {
  return {
    from(table) {
      let key;
      const chain = {
        select: () => chain,
        eq: (_c, v) => { key = v; return chain; },
        maybeSingle: async () => {
          if (table === 'users') return { data: users[key] ? { role: users[key] } : null, error: null };
          if (value === THROW) throw new Error('socket hang up');
          if (value === ERROR) return { data: null, error: { message: 'upstream timeout' } };
          if (value === ABSENT) return { data: null, error: null };
          return { data: { key, value }, error: null };
        },
      };
      return chain;
    },
  };
}

const ROWS = [
  ['true', true], ['"true"', 'true'], ['\'"true"\'', '"true"'], ['false', false], ['null', null], ['1', 1],
  ['{}', {}], ['[]', []], ['["u-1"]', ['u-1']], ['[1]', [1]], ['"u-1"', 'u-1'], ['malformed', '["u-1"'],
  ['JSON list string', '["u-1"]'], ['" TRUE "', ' TRUE '], ['absent row', ABSENT], ['DB error', ERROR], ['client throws', THROW],
];
const USERS = ['u-1', 'u-2', null];
const CASES = [];
ROWS.forEach(([name, value]) => USERS.forEach((u) => CASES.push([name, u, value])));

describe('isFlagEnabledForUser: bot port answers as the dashboard does', () => {
  test.each(CASES)('row %s, user %j', async (_name, userId, value) => {
    mockCurrent = fakeDb(value);
    const fromBot = await bot.isFlagEnabledForUser(KEY, userId);
    const fromDash = await dash.isFlagEnabledForUser(fakeDb(value), KEY, userId);
    expect(typeof fromBot).toBe('boolean');
    expect(fromBot).toBe(fromDash);
  });

  test('the table is not trivially all-false: true and the pilot list admit u-1', async () => {
    mockCurrent = fakeDb(true);
    expect(await bot.isFlagEnabledForUser(KEY, 'u-1')).toBe(true);
    mockCurrent = fakeDb(['u-1']);
    expect(await bot.isFlagEnabledForUser(KEY, 'u-1')).toBe(true);
    expect(await bot.isFlagEnabledForUser(KEY, 'u-2')).toBe(false);
  });

  test('"teachers" is the documented divergence: the bot answers false, with no users read', async () => {
    const reads = [];
    mockCurrent = { from: (t) => { reads.push(t); return fakeDb('teachers', { 'u-1': 'teacher' }).from(t); } };
    expect(await bot.isFlagEnabledForUser(KEY, 'u-1')).toBe(false);
    expect(reads).toEqual(['app_settings']);
    expect(await dash.isFlagEnabledForUser(fakeDb('teachers', { 'u-1': 'teacher' }), KEY, 'u-1')).toBe(true);
  });

  test('the bot reads the key it is asked for', async () => {
    const keys = [];
    mockCurrent = { from: () => { const c = fakeDb(true).from('app_settings'); const eq = c.eq; c.eq = (col, v) => { keys.push([col, v]); return eq(col, v); }; return c; } };
    await bot.isFlagEnabledForUser(KEY, 'u-1');
    expect(keys).toEqual([['key', KEY]]);
  });
});
