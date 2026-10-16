'use strict';
/**
 * bd-v0toag.10 — `quiz_slo_retest_enabled` gates every v21 quiz change (SLO codes, retest,
 * who-helped, completion). Default off: no row, a false row, or a failed read all mean off.
 */
const { makeDb } = require('./helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Flag = require('../../bot/shared/services/quiz/quiz-v21-flag');

beforeEach(() => { Flag._reset(); });

test('the key is quiz_slo_retest_enabled', () => {
  expect(Flag.FLAG_KEY).toBe('quiz_slo_retest_enabled');
});

test('no app_settings row → off', async () => {
  mockDb = makeDb({ app_settings: [] });
  expect(await Flag.v21On()).toBe(false);
});

test.each([[true], ['true'], [{ enabled: true }]])('value %p → on', async (value) => {
  mockDb = makeDb({ app_settings: [{ key: 'quiz_slo_retest_enabled', value }] });
  expect(await Flag.v21On()).toBe(true);
});

test.each([[false], ['false'], [{ enabled: false }], [null]])('value %p → off', async (value) => {
  mockDb = makeDb({ app_settings: [{ key: 'quiz_slo_retest_enabled', value }] });
  expect(await Flag.v21On()).toBe(false);
});

test('a failed read fails closed and logs', async () => {
  mockDb = makeDb({}, { failTables: ['app_settings'] });
  const { logToFile } = require('../../bot/shared/utils/logger');
  expect(await Flag.v21On()).toBe(false);
  expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/quiz_slo_retest_enabled/), expect.any(Object));
});

test('the value is cached for a minute — one read for two asks', async () => {
  mockDb = makeDb({ app_settings: [{ key: 'quiz_slo_retest_enabled', value: true }] });
  await Flag.v21On();
  mockDb.tables.app_settings[0].value = false;
  expect(await Flag.v21On()).toBe(true);
  expect(mockDb.reads.filter((t) => t === 'app_settings')).toHaveLength(1);
});
