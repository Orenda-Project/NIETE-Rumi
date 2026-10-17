'use strict';
/**
 * The lesson claim's log line names the teacher by keyed reference (tk), never by the raw users.id.
 *
 * Driven through claimLessons; the database, Redis and the loggers are the boundary.
 */

let mockRows = [];
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    delete: () => chain,
    then: (resolve) => resolve({ data: mockRows, error: null }),
  };
  return { from: () => chain };
});
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true),
  delete: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { claimLessons } = require('../../bot/shared/services/quiz/lp-lesson-claim');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { tk: tkOf } = require('../../bot/shared/services/quiz/web-quiz-kid');

const T = '11111111-1111-4111-8111-111111111111';
const LESSON = 'lesson-a';
const claimed = () => logEvent.mock.calls.filter(([n]) => n === 'quiz_menu.lesson_claimed').map(([, p]) => p);

let savedKey;
beforeEach(() => {
  jest.clearAllMocks();
  mockRows = [];
  savedKey = process.env.WEB_QUIZ_KID_KEY;
  process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(32);
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.WEB_QUIZ_KID_KEY;
  else process.env.WEB_QUIZ_KID_KEY = savedKey;
});

test('a won claim logs the teacher\'s tk and no userId', async () => {
  const insert = jest.fn(async () => {
    mockRows = [{ id: 'q-1', created_at: new Date().toISOString(), lessons: [{ lesson_id: LESSON }] }];
    return 'q-1';
  });
  const out = await claimLessons({ teacherId: T, lessonIds: [LESSON], insert, via: 'list' });
  expect(out).toEqual({ won: true, quizId: 'q-1' });
  const [p] = claimed();
  expect(p).toEqual(expect.objectContaining({ tk: tkOf(T), won: true, via: 'list', quizId: 'q-1', lessons: 1 }));
  expect(p.tk).toMatch(/^[0-9a-f]{16}$/);
  expect(p).not.toHaveProperty('userId');
});

test('a covered lesson logs the teacher\'s tk and no userId', async () => {
  mockRows = [{ id: 'q-0', created_at: new Date().toISOString(), lessons: [{ lesson_id: LESSON }] }];
  const out = await claimLessons({ teacherId: T, lessonIds: [LESSON], insert: jest.fn(), via: 'flow' });
  expect(out.reason).toBe('covered');
  const [p] = claimed();
  expect(p).toEqual(expect.objectContaining({ tk: tkOf(T), won: false, reason: 'covered', quizId: 'q-0' }));
  expect(p).not.toHaveProperty('userId');
});
