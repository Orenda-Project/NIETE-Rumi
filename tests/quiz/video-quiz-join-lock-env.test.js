'use strict';
/**
 * The one-join-per-minute lock on a class-quiz link (JOIN_LOCK_SECS) can be shortened for a
 * test lane through VIDEO_QUIZ_JOIN_LOCK_SECS; unset, it stays 60 seconds. A driver that
 * exercises "the child opens the link again" waited a full minute per scenario for it.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

function load(v) {
  jest.resetModules();
  if (v == null) delete process.env.VIDEO_QUIZ_JOIN_LOCK_SECS; else process.env.VIDEO_QUIZ_JOIN_LOCK_SECS = v;
  return require('../../bot/shared/services/quiz/video-quiz-share.service').JOIN_LOCK_SECS;
}
afterAll(() => { delete process.env.VIDEO_QUIZ_JOIN_LOCK_SECS; });
test('unset → 60 s', () => { expect(load(null)).toBe(60); });
test('VIDEO_QUIZ_JOIN_LOCK_SECS=5 → 5 s', () => { expect(load('5')).toBe(5); });
test('a non-number keeps 60 s and says so', () => {
  expect(load('soon')).toBe(60);
  const { logToFile } = require('../../bot/shared/utils/logger');
  expect(logToFile.mock.calls.some((k) => /VIDEO_QUIZ_JOIN_LOCK_SECS/.test(k[0]) && k[2] === 'warn')).toBe(true);
});
test('a value above an hour is rejected to 60', () => { expect(load('600000')).toBe(60); });
