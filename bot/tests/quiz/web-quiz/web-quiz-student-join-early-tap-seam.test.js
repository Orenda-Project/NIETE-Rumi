'use strict';
/**
 * The join page's early-tap switch (quiz_join_early_tap) on the hub's one switch read (web_quiz_fast on,
 * web-quiz-hub-switches.js): the rows that read carried prime the join flags with no read of their own, parsed exactly as
 * the join's own read parses them (JSON true only). Off the seam, the join's own reads are today's: the join switch, then
 * the early-tap switch.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/quiz/web-quiz-identity-flags', () => ({
  flags: async () => ({ phoneBind: false }), isTrue: (v) => v === true,
}));

const supabase = require('../../../shared/config/supabase');
const Join = require('../../../shared/services/quiz/web-quiz-student-join');

let asked;
function seed(rows) {
  asked = [];
  supabase.from = (t) => {
    const b = { select: () => b, eq: (col, key) => { asked.push(`${t}:${key}`); return Promise.resolve({ data: rows.filter((r) => r.key === key), error: null }); } };
    return b;
  };
}

beforeEach(() => { Join._resetCache(); });

describe('the join flags primed by the hub\'s one switch read', () => {
  test('the seam asks for the early-tap key beside the join switch', () => {
    expect(Join.hubSwitches.keys).toEqual(['quiz_student_join', 'quiz_join_early_tap']);
  });

  test.each([
    [true, true],
    ['true', false],
    [1, false],
    [{ enabled: true }, false],
    [undefined, false],
  ])('early tap %p → earlyTap %p, and no read of its own', async (value, want) => {
    seed([]);
    const rows = [{ key: 'quiz_student_join', value: true }, ...(value === undefined ? [] : [{ key: 'quiz_join_early_tap', value }])];
    const f = await Join.hubSwitches.prime(rows, Date.now());
    expect(f).toEqual(expect.objectContaining({ on: true, earlyTap: want }));
    expect((await Join.flags()).earlyTap).toBe(want);
    expect(asked).toEqual([]);
  });

  test('the join switch off: the early tap is off whatever its row says', async () => {
    seed([]);
    const f = await Join.hubSwitches.prime([{ key: 'quiz_student_join', value: false }, { key: 'quiz_join_early_tap', value: true }], Date.now());
    expect(f).toEqual(expect.objectContaining({ on: false, earlyTap: false }));
    expect(asked).toEqual([]);
  });
});

describe('the join\'s own read (no seam): today\'s reads', () => {
  test('the join switch, then the early-tap switch', async () => {
    seed([{ key: 'quiz_student_join', value: true }, { key: 'quiz_join_early_tap', value: true }]);
    expect(await Join.flags()).toEqual(expect.objectContaining({ on: true, earlyTap: true }));
    expect(asked).toEqual(['app_settings:quiz_student_join', 'app_settings:quiz_join_early_tap']);
  });

  test('the join switch off: the early-tap switch is never read', async () => {
    seed([{ key: 'quiz_student_join', value: false }, { key: 'quiz_join_early_tap', value: true }]);
    expect(await Join.flags()).toEqual(expect.objectContaining({ on: false, earlyTap: false }));
    expect(asked).toEqual(['app_settings:quiz_student_join']);
  });
});
