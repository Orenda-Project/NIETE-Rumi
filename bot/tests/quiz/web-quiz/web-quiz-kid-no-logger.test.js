'use strict';
/**
 * web-quiz-kid without its logger. The teacher portal deploys dashboard/node_modules only, so there the structured
 * logger cannot load (it needs pino). The portal reads tk() from this module, so loading it and calling tk() / kid()
 * must work with the logger unloadable: the value under a key, null without one, never a throw.
 */
const crypto = require('crypto');

const KEY = 'test-only-kid-key-0123456789abcdef0123456789';
const TEACHER = 'a0000000-0000-4000-8000-000000000001';
const CHILD = '44444444-4444-4444-8444-000000000001';
const hmac = (s) => crypto.createHmac('sha256', KEY).update(s).digest('hex');

// The events-v2 switch is the only other module emit() reaches (lazily); it is faked so no database client loads.
function loadWithoutLogger({ v2 = false } = {}) {
  let K;
  jest.isolateModules(() => {
    jest.doMock('../../../shared/utils/structured-logger', () => { throw new Error("Cannot find module 'pino'"); });
    jest.doMock('../../../shared/services/quiz/web-quiz-hub-flags', () => ({ eventsV2On: async () => v2 }));
    K = require('../../../shared/services/quiz/web-quiz-kid');
  });
  return K;
}

afterEach(() => {
  delete process.env.WEB_QUIZ_KID_KEY;
  delete process.env.WEB_QUIZ_KID_KEY_V;
  jest.dontMock('../../../shared/utils/structured-logger');
  jest.dontMock('../../../shared/services/quiz/web-quiz-hub-flags');
});

test('it loads with the structured logger unloadable', () => {
  expect(loadWithoutLogger).not.toThrow();
});

test('tk under a 32+ byte key is the 16-hex keyed reference', () => {
  process.env.WEB_QUIZ_KID_KEY = KEY;
  const K = loadWithoutLogger();
  expect(K.tk(TEACHER)).toBe(hmac(`t|${TEACHER}`).slice(0, 16));
  expect(K.tk(TEACHER)).toMatch(/^[0-9a-f]{16}$/);
  expect(K.kid(CHILD)).toBe(hmac(`kid|${CHILD}`).slice(0, 16));
});

test('without a key tk and kid are null and never throw (the missing-key line cannot be logged)', () => {
  const K = loadWithoutLogger();
  expect(() => K.tk(TEACHER)).not.toThrow();
  expect(K.tk(TEACHER)).toBeNull();
  expect(K.kid(CHILD)).toBeNull();
  process.env.WEB_QUIZ_KID_KEY = 'short-key';
  expect(K.tk(TEACHER)).toBeNull();
});

test('emit never rejects when the logger cannot load', async () => {
  for (const v2 of [false, true]) {
    const K = loadWithoutLogger({ v2 });
    await expect(K.emit('web_quiz.test_event', { n: 1 })).resolves.toBeUndefined();
    await expect(K.emit('web_quiz.test_event', { n: 1 }, { kind: 'mark' })).resolves.toBeUndefined();
  }
});
