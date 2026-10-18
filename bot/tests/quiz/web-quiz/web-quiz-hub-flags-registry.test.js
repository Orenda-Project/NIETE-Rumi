'use strict';
/**
 * The hub's switches as one list, one line per switch (web-quiz-hub-flags.js SWITCHES), so two changes that each add a
 * switch touch different lines instead of the same four (the key list, the cached answer, the failed read's answer and
 * the exports). Pinned here:
 *   - SWITCHES is one source line per key, in key order, and KEYS is exactly its keys;
 *   - every rule answers as the hand-written lines did (a 'loose' switch takes the string 'true', a 'json' one only the
 *     JSON true, the meter its variant), and the one share needs both its keys as the JSON true;
 *   - a failed read answers every field off (the meter: none), and nowOf(field) reads the cache for two cache lives.
 * Supabase and the loggers are the boundaries.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const SRC = path.join(__dirname, '../../../shared/services/quiz/web-quiz-hub-flags.js');
let rows = [];
let fail = false;
function seed() {
  Object.assign(require('../../../shared/config/supabase'), {
    from() {
      const b = {
        select() { return b; }, in() { return b; },
        then(res, rej) { return Promise.resolve(fail ? { data: null, error: { message: 'down' } } : { data: rows, error: null }).then(res, rej); },
      };
      return b;
    },
  });
}
let Flags;
beforeEach(() => {
  jest.resetModules();
  rows = [];
  fail = false;
  seed();
  Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
});

describe('one line per switch', () => {
  test('SWITCHES is one source line per key, in key order, and KEYS is exactly its keys', () => {
    expect(Array.isArray(Flags.SWITCHES)).toBe(true);
    const src = fs.readFileSync(SRC, 'utf8');
    const block = src.slice(src.indexOf('const SWITCHES = Object.freeze(['), src.indexOf(']);', src.indexOf('const SWITCHES = Object.freeze([')));
    const lines = block.split('\n').slice(1).filter((l) => l.trim());
    expect(lines).toHaveLength(Flags.SWITCHES.length);
    lines.forEach((l) => expect(l).toMatch(/^ {2}\[(null|'[A-Za-z0-9]+'), +[A-Z0-9_]+_KEY, +'(loose|json|meter|read)'\],$/));
    const keys = Flags.SWITCHES.map(([, key]) => key);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...Flags.KEYS]).toEqual(keys);
  });

  test('the exports are one per line', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    const block = src.slice(src.indexOf('module.exports = {'));
    expect(block.split('\n')[0]).toBe('module.exports = {');
  });
});

describe('every rule answers as before', () => {
  const field = (rule) => Flags.SWITCHES.filter(([f, , r]) => f && r === rule);
  test.each([
    ['the JSON true', true, { loose: true, json: true, meter: 'sky' }],
    ["the string 'true'", 'true', { loose: true, json: false, meter: 'sky' }],
    ['1', 1, { loose: false, json: false, meter: null }],
    ['an object', { on: true }, { loose: false, json: false, meter: null }],
    ["'vine'", 'vine', { loose: false, json: false, meter: 'vine' }],
    ['no row', undefined, { loose: false, json: false, meter: null }],
  ])('%s', async (_n, value, want) => {
    rows = value === undefined ? [] : Flags.SWITCHES.map(([, key]) => ({ key, value }));
    const f = await Flags.flags();
    for (const rule of ['loose', 'json', 'meter']) for (const [name] of field(rule)) expect([name, f[name]]).toEqual([name, want[rule]]);
    expect(f.shareOpen).toBe(value === true);
  });

  test('the fields are the ones the hub reads today', async () => {
    const f = await Flags.flags();
    expect(Object.keys(f)).toEqual(expect.arrayContaining(['hub', 'challenge', 'library', 'door', 'childHome', 'homeButton', 'backNav',
      'eventsV2', 'challengeV2', 'rungs', 'readalong', 'oneButton', 'waitUx', 'serverTiming', 'fanout', 'childMemo', 'shareOpen', 'adv',
      'edgeLearn', 'homePreload', 'closedLang', 'plainPaint', 'waves2', 'liveMeter', 'liveReadV3', 'hops']));
  });
});

describe('a failed read, and nowOf', () => {
  test('a failed read: every field off, the meter none, and nothing cached', async () => {
    fail = true;
    const f = await Flags.flags();
    for (const [name, , rule] of Flags.SWITCHES) if (name) expect([name, f[name]]).toEqual([name, rule === 'meter' ? null : false]);
    expect(Flags.nowOf('hub')).toBe(false);
  });

  test('nowOf: the cached field for two cache lives, off after, off when cold', async () => {
    expect(Flags.nowOf('fanout')).toBe(false);
    rows = [{ key: Flags.FANOUT_KEY, value: true }];
    const t0 = Date.now();
    await Flags.flags(t0);
    expect(Flags.nowOf('fanout', t0 + 59 * 1000)).toBe(true);
    expect(Flags.nowOf('fanout', t0 + 61 * 1000)).toBe(false);
    expect(Flags.nowOf('waitUx', t0)).toBe(false);
  });
});
