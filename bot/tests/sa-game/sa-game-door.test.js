'use strict';
/**
 * The big flight's row in the games door (sa-game-door.js; app_settings sa_game, default OFF).
 * The door reads the switch from the hub's warm switch cache (web-quiz-hub-flags nowOf('battery')): no read of its own;
 * the page reads it with its own 30 s read.
 * Off, cold or broken: the door's answer comes back as the same object, untouched. On: one row, kind bigtest, after the
 * door's own rows, its href the game page for this hub token and chip, its words never a test word. Invented values.
 */
const mockNowOf = jest.fn();
jest.mock('../../shared/services/quiz/web-quiz-hub-flags', () => ({ nowOf: (...a) => mockNowOf(...a) }));
const mockRows = jest.fn();
jest.mock('../../shared/config/supabase', () => ({ from: () => ({ select: () => ({ eq: () => mockRows() }) }) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const Flag = require('../../shared/services/sa-game/flag');
const Door = require('../../shared/services/quiz/sa-game-door');

const WHO = { studentId: 'kid-1', grade: '3', lang: 'ur' };
const TOKEN = 'eyJpZHMiOlsia2lkLTEiXX0.abcdefghijklmnopqrstuv';
const CHIP = '0123456789abcdef';
const doorOut = () => ({ games: [{ kind: 'numbers', stop: 'bigger', name: 'Which is bigger?' }] });

beforeEach(() => { mockNowOf.mockReset(); mockRows.mockReset(); Flag._resetCache(); });

describe('sa_game switch', () => {
  test('on(): its own 30 s read, JSON true only; no row or a failed read is off', async () => {
    mockRows.mockResolvedValue({ data: [{ key: 'sa_game', value: true }], error: null });
    expect(await Flag.on()).toBe(true);
    Flag._resetCache();
    mockRows.mockResolvedValue({ data: [{ key: 'sa_game', value: 'true' }], error: null });
    expect(await Flag.on()).toBe(false);
    Flag._resetCache();
    mockRows.mockResolvedValue({ data: [], error: null });
    expect(await Flag.on()).toBe(false);
    Flag._resetCache();
    mockRows.mockRejectedValue(new Error('down'));
    expect(await Flag.on()).toBe(false);
  });
  test('now() is the warm cache only', () => {
    mockNowOf.mockReturnValue(true);
    expect(Flag.now()).toBe(true);
    expect(mockNowOf).toHaveBeenCalledWith('battery');
    mockNowOf.mockImplementation(() => { throw new Error('x'); });
    expect(Flag.now()).toBe(false);
  });
});

describe('addRow', () => {
  test('off (or a cold cache): the very same object, unchanged, and no settings read', () => {
    mockNowOf.mockReturnValue(false);
    const out = doorOut();
    const before = JSON.stringify(out);
    expect(Door.addRow(out, WHO, { token: TOKEN, kid: CHIP, lang: 'ur' })).toBe(out);
    expect(JSON.stringify(out)).toBe(before);
    expect(mockRows).not.toHaveBeenCalled();
  });
  test('on: one bigtest row after the door rows, in the hub language, no test words', () => {
    mockNowOf.mockReturnValue(true);
    const res = Door.addRow(doorOut(), WHO, { token: TOKEN, kid: CHIP, lang: 'ur' });
    expect(res.games).toHaveLength(2);
    expect(res.games[0].kind).toBe('numbers');
    expect(res.games[1]).toEqual({ kind: 'bigtest', href: `/sa-game/${TOKEN}?kid=${CHIP}&lang=ur`, name: Door.NAME.ur });
    expect(Door.addRow(doorOut(), WHO, { token: TOKEN, kid: CHIP, lang: 'en' }).games[1].name).toBe(Door.NAME.en);
    for (const n of Object.values(Door.NAME)) expect(n).not.toMatch(/test|exam|assess|challenge|level|ٹیسٹ|امتحان|چیلنج/i);
    expect(mockRows).not.toHaveBeenCalled();
  });
  test('on, but a failed door, no child, or a bad token/chip: unchanged', () => {
    mockNowOf.mockReturnValue(true);
    const failed = { games: [], err: 1 };
    expect(Door.addRow(failed, WHO, { token: TOKEN, kid: CHIP, lang: 'en' })).toBe(failed);
    const out = doorOut();
    expect(Door.addRow(out, WHO, { token: 'bad token/../x', kid: CHIP, lang: 'en' })).toBe(out);
    expect(Door.addRow(out, WHO, { token: TOKEN, kid: 'zz', lang: 'en' })).toBe(out);
    expect(Door.addRow(out, null, { token: TOKEN, kid: CHIP, lang: 'en' })).toBe(out);
    expect(Door.addRow(undefined, WHO, {})).toBeUndefined();
  });
});
