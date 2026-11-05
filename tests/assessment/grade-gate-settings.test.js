/**
 * G6-12 contract 1 §4: GradeGateSettings.load() mockReads the three app_settings keys per call, no cache.
 * Flag absent / off / unreadable -> { flag: false } after ONE read (prod has no row). Otherwise the
 * two kill mockRows are read too and the raw decoded values come back for A/grade-gate.js to judge.
 */
let mockRows;
let mockReads;
let mockFailKey;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => {
    let key;
    const chain = {
      select: () => chain,
      eq: (_c, v) => { key = v; return chain; },
      maybeSingle: async () => {
        mockReads.push(key);
        if (mockFailKey === key) return { data: null, error: { message: 'upstream timeout' } };
        if (mockFailKey === `${key}!`) throw new Error('socket hang up');
        return { data: Object.prototype.hasOwnProperty.call(mockRows, key) ? { value: mockRows[key] } : null, error: null };
      },
    };
    return chain;
  },
}));
const mockLogger = { logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() };
jest.mock('../../bot/shared/utils/logger', () => mockLogger);

const { GradeGateSettings, ASSESSMENT_GRADES_6_12_KEY, ASSESSMENT_GRADES_6_12_KILL_KEY, ASSESSMENT_GRADES_6_12_KILL_CELLS_KEY }
  = require('../../bot/shared/config/feature-flags');

const F = 'assessment_grades_6_12';
const K = 'assessment_grades_6_12_kill';
const C = 'assessment_grades_6_12_kill_cells';

beforeEach(() => { mockRows = {}; mockReads = []; mockFailKey = null; mockLogger.logToFile.mockClear(); });

describe('GradeGateSettings.load', () => {
  test('the three keys are the contract names', () => {
    expect([ASSESSMENT_GRADES_6_12_KEY, ASSESSMENT_GRADES_6_12_KILL_KEY, ASSESSMENT_GRADES_6_12_KILL_CELLS_KEY]).toEqual([F, K, C]);
  });

  test.each([['absent', undefined], ['false', false], ['"false"', 'false'], ['[]', []], ['junk', 'teachers'], ['null', null]])(
    'flag %s -> { flag: false } after one read', async (_n, value) => {
      if (value !== undefined) mockRows[F] = value;
      mockRows[K] = [11];
      expect(await GradeGateSettings.load()).toEqual({ flag: false });
      expect(mockReads).toEqual([F]);
    });

  test.each([[true], ['true'], [['u-1']], ['["u-1"]']])('flag %j -> the three raw values', async (value) => {
    mockRows[F] = value; mockRows[K] = '[11]'; mockRows[C] = ['9:chemistry'];
    expect(await GradeGateSettings.load()).toEqual({ flag: value, kill: '[11]', killCells: ['9:chemistry'] });
    expect(mockReads.sort()).toEqual([F, K, C].sort());
  });

  test('absent kill mockRows come back undefined (nothing killed)', async () => {
    mockRows[F] = true;
    expect(await GradeGateSettings.load()).toEqual({ flag: true, kill: undefined, killCells: undefined });
  });

  test('a failed read of the flag is OFF and logged', async () => {
    mockRows[F] = true; mockFailKey = F;
    expect(await GradeGateSettings.load()).toEqual({ flag: false });
    expect(mockReads).toEqual([F]);
  });

  test.each([[K], [C]])('a failed read of %s is OFF for the whole gate', async (key) => {
    mockRows[F] = true; mockFailKey = key;
    expect(await GradeGateSettings.load()).toEqual({ flag: false });
    expect(mockLogger.logToFile).toHaveBeenCalledWith(expect.stringMatching(/treating as off/), expect.objectContaining({ error: expect.any(String) }));
  });

  test.each([[F], [K], [C]])('a throw reading %s is OFF and logged', async (key) => {
    mockRows[F] = true; mockFailKey = `${key}!`;
    expect(await GradeGateSettings.load()).toEqual({ flag: false });
    expect(mockLogger.logToFile).toHaveBeenCalledWith(expect.stringMatching(/treating as off/), expect.anything());
  });

  test('no cache: a change shows on the next call', async () => {
    mockRows[F] = true;
    expect((await GradeGateSettings.load()).flag).toBe(true);
    delete mockRows[F];
    expect(await GradeGateSettings.load()).toEqual({ flag: false });
  });
});
