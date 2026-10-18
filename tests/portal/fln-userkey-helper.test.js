'use strict';
/**
 * The FLN keyed teacher reference comes from ONE helper, web-quiz-kid `tk`, on both sides:
 *   - the portal's userKeyOf (dashboard/routes/portal-fln.routes.js) on every /fln/events row and log line;
 *   - the bot's userKey (bot/shared/services/fln-keys.js) on a `send` row's sender and recipient.
 * The portal service does not install the bot's pino, so here the bot logger cannot be loaded at all (its require
 * throws, as it does on the portal): web-quiz-kid must still load, tk must still answer, and a missing key must give
 * null, never a throw out of the route.
 */
const crypto = require('crypto');

const ID = 'a0000000-0000-4000-8000-000000000001';
const KEY = 'k'.repeat(32);
const formula = (id, k = KEY) => crypto.createHmac('sha256', k).update(['t', id].join('|')).digest('hex').slice(0, 16);
const LOGGER = '../../bot/shared/utils/structured-logger';

let saved;
beforeEach(() => {
  saved = process.env.WEB_QUIZ_KID_KEY;
  jest.resetModules();
  jest.doMock(LOGGER, () => { throw new Error("Cannot find module 'pino'"); });
});
afterEach(() => {
  if (saved === undefined) delete process.env.WEB_QUIZ_KID_KEY; else process.env.WEB_QUIZ_KID_KEY = saved;
  jest.dontMock(LOGGER);
});

test('web-quiz-kid loads and tk answers on a host without the bot logger', () => {
  process.env.WEB_QUIZ_KID_KEY = KEY;
  const kid = require('../../bot/shared/services/quiz/web-quiz-kid');
  expect(kid.tk(ID)).toBe(formula(ID));
});

test('the portal userKeyOf is tk: same value, and null (not a throw) with no key or a short one', () => {
  process.env.WEB_QUIZ_KID_KEY = KEY;
  const { userKeyOf } = require('../../dashboard/routes/portal-fln.routes');
  expect(userKeyOf(ID)).toBe(formula(ID));
  expect(userKeyOf(` ${ID} `)).toBe(formula(ID));
  expect(userKeyOf('')).toBeNull();
  delete process.env.WEB_QUIZ_KID_KEY;
  expect(userKeyOf(ID)).toBeNull();
  process.env.WEB_QUIZ_KID_KEY = 'short';
  expect(userKeyOf(ID)).toBeNull();
});

test('the bot userKey is tk, and loading fln-keys (as the portal does for teacherKey) does not load web-quiz-kid', () => {
  process.env.WEB_QUIZ_KID_KEY = KEY;
  const keys = require('../../bot/shared/services/fln-keys');
  expect(Object.keys(require.cache).some((f) => f.endsWith('web-quiz-kid.js'))).toBe(false);
  expect(keys.userKey(ID)).toBe(formula(ID));
});
