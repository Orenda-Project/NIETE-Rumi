'use strict';
/**
 * The Big Test's row in the games door (sa-game-door.js, app_settings sa_game, default OFF).
 * Off, unreadable or broken: the door's answer comes back as the same object, untouched. On: one row, kind bigtest,
 * after the door's own rows, its href the game page for this hub token and chip. Invented tokens and chips only.
 */
const mockRows = jest.fn();
jest.mock('../../shared/config/supabase', () => ({
  from: () => ({ select: () => ({ eq: () => mockRows() }) }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const Flag = require('../../shared/services/sa-game/flag');
const Door = require('../../shared/services/quiz/sa-game-door');

const WHO = { studentId: 'kid-1', grade: '3', lang: 'ur' };
const TOKEN = 'eyJpZHMiOlsia2lkLTEiXX0.abcdefghijklmnopqrstuv';
const CHIP = '0123456789abcdef';
const doorOut = () => ({ games: [{ kind: 'numbers', stop: 'bigger', name: 'Which is bigger?' }] });

beforeEach(() => { Flag._resetCache(); mockRows.mockReset(); });

describe('sa_game switch', () => {
  test('no row is off', async () => {
    mockRows.mockResolvedValue({ data: [], error: null });
    expect(await Flag.on()).toBe(false);
  });
  test('only the JSON boolean true is on', async () => {
    mockRows.mockResolvedValue({ data: [{ key: 'sa_game', value: 'true' }], error: null });
    expect(await Flag.on()).toBe(false);
    Flag._resetCache();
    mockRows.mockResolvedValue({ data: [{ key: 'sa_game', value: true }], error: null });
    expect(await Flag.on()).toBe(true);
  });
  test('a failed read is off', async () => {
    mockRows.mockRejectedValue(new Error('down'));
    expect(await Flag.on()).toBe(false);
  });
});

describe('addRow', () => {
  test('off: the very same object, unchanged', async () => {
    mockRows.mockResolvedValue({ data: [], error: null });
    const out = doorOut();
    const before = JSON.stringify(out);
    expect(await Door.addRow(out, WHO, { token: TOKEN, kid: CHIP, lang: 'ur' })).toBe(out);
    expect(JSON.stringify(out)).toBe(before);
  });
  test('on: one bigtest row after the door rows, in the hub language', async () => {
    mockRows.mockResolvedValue({ data: [{ key: 'sa_game', value: true }], error: null });
    const res = await Door.addRow(doorOut(), WHO, { token: TOKEN, kid: CHIP, lang: 'ur' });
    expect(res.games).toHaveLength(2);
    expect(res.games[0].kind).toBe('numbers');
    expect(res.games[1]).toEqual({ kind: 'bigtest', href: `/sa-game/${TOKEN}?kid=${CHIP}&lang=ur`, name: Door.NAME.ur });
    const en = await Door.addRow(doorOut(), WHO, { token: TOKEN, kid: CHIP, lang: 'en' });
    expect(en.games[1].name).toBe(Door.NAME.en);
  });
  test('on, but no games list (a failed door) or a bad token/chip: unchanged', async () => {
    mockRows.mockResolvedValue({ data: [{ key: 'sa_game', value: true }], error: null });
    const failed = { games: [], err: 1 };
    expect(await Door.addRow(failed, WHO, { token: TOKEN, kid: CHIP, lang: 'en' })).toBe(failed);
    const out = doorOut();
    expect(await Door.addRow(out, WHO, { token: 'bad token/../x', kid: CHIP, lang: 'en' })).toBe(out);
    expect(await Door.addRow(out, WHO, { token: TOKEN, kid: 'zz', lang: 'en' })).toBe(out);
    expect(await Door.addRow(out, null, { token: TOKEN, kid: CHIP, lang: 'en' })).toBe(out);
  });
  test('a throw inside is swallowed: unchanged', async () => {
    mockRows.mockImplementation(() => { throw new Error('boom'); });
    const out = doorOut();
    expect(await Door.addRow(out, WHO, { token: TOKEN, kid: CHIP, lang: 'en' })).toBe(out);
  });
});
