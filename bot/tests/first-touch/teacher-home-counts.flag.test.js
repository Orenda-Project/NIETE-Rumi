'use strict';
/**
 * The story counts switch: only the JSON boolean `true` is on; absent, the string "true", false, 1 and a failed read
 * are off; a reading is kept 30 s.
 */
let mockRows = [];
let mockError = null;
let mockReads = 0;
jest.mock('../../shared/config/supabase', () => ({
  from: () => ({ select: () => ({ eq: async (k, v) => { mockReads += 1; if (mockError) throw mockError; return { data: mockRows.filter((r) => r[k] === v), error: null }; } }) }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Flag = require('../../shared/services/first-touch/teacher-home-counts.flag');

beforeEach(() => { mockRows = []; mockError = null; mockReads = 0; Flag._resetCache(); });

describe('quiz_teacher_story_counts', () => {
  test('its key', () => { expect(Flag.KEY).toBe('quiz_teacher_story_counts'); });

  test('JSON true → on', async () => {
    mockRows = [{ key: 'quiz_teacher_story_counts', value: true }];
    expect(await Flag.on()).toBe(true);
  });

  test.each([
    ['absent', []],
    ['the string "true"', [{ key: 'quiz_teacher_story_counts', value: 'true' }]],
    ['false', [{ key: 'quiz_teacher_story_counts', value: false }]],
    ['1', [{ key: 'quiz_teacher_story_counts', value: 1 }]],
    ['another key on', [{ key: 'quiz_teacher_home', value: true }]],
  ])('%s → off', async (_name, rows) => {
    mockRows = rows;
    expect(await Flag.on()).toBe(false);
  });

  test('a failed read → off, never throws', async () => {
    mockError = new Error('down');
    await expect(Flag.on()).resolves.toBe(false);
  });

  test('a reading is kept 30 s, then read again', async () => {
    mockRows = [{ key: 'quiz_teacher_story_counts', value: true }];
    expect(await Flag.on(1000)).toBe(true);
    mockRows = [];
    expect(await Flag.on(1000 + 29999)).toBe(true);
    expect(mockReads).toBe(1);
    expect(await Flag.on(1000 + 30000)).toBe(false);
    expect(mockReads).toBe(2);
  });
});
