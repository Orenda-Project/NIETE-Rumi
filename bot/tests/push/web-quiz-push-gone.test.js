'use strict';
/**
 * remind_step accepts the page's `gone` step (the page went away with the ask up and unanswered) and logs `dwell_ms`,
 * how long the ask was up, only on the first answer after it (yes / later / escape / gone) and only as whole
 * milliseconds from 0 to one day. Anything else about dwell_ms is dropped; every other prop is as before.
 * Through the internal router (portal → bot) with a fake database. Invented values.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceKids: jest.fn(async () => []) }));

const crypto = require('crypto');
const express = require('express');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const Push = require('../../shared/services/push/web-quiz-push.service');
const { mountPushRemind, MOUNT_PATH } = require('../../shared/services/first-touch/push-remind.mount');

const ENV = {
  WQ_PUSH_VAPID_PUBLIC: 'BPubKey', WQ_PUSH_VAPID_PRIVATE: 'priv', WQ_PUSH_VAPID_SUBJECT: 'mailto:test@example.org',
  WQ_PUSH_ENC_KEY: crypto.randomBytes(32).toString('base64'), WQ_PUSH_HASH_SALT: 'salt',
};
const PS = 'k3j9x0a1b2c4';
const DAY_MS = 86400000;

let fake;
let srv;
let base;
const call = (body) => fetch(`${base}${MOUNT_PATH}/e`, {
  method: 'POST', headers: { 'x-api-key': process.env.INTERNAL_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const logged = () => logEvent.mock.calls.filter(([e]) => e === 'web_quiz.remind_step').map(([, d]) => d);

beforeAll(async () => {
  Object.assign(process.env, ENV);
  const app = express();
  expect(mountPushRemind(app)).toBe(true);
  srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(() => srv && srv.close());
beforeEach(() => {
  fake = makeFake({ app_settings: [{ key: 'web_quiz_push_remind', value: true }], web_quiz_push_subscriptions: [] });
  supabase.from = (t) => fake.from(t);
  Push.__reset();
  logEvent.mockClear();
});

describe('gone', () => {
  test('a gone step is accepted and logged with its dwell_ms', async () => {
    const r = await call({ step: 'gone', lang: 'en', src: 'result', ps: PS, dwell_ms: 7000 });
    expect(r.status).toBe(200);
    expect(logged()).toEqual([{ step: 'gone', lang: 'en', src: 'result', ps: PS, dwell_ms: 7000 }]);
  });
  test('gone from WhatsApp\'s browser keeps iab', async () => {
    expect((await call({ step: 'gone', lang: 'ur', src: 'result', iab: true, dwell_ms: 900 })).status).toBe(200);
    expect(logged()).toEqual([{ step: 'gone', lang: 'ur', src: 'result', iab: true, dwell_ms: 900 }]);
  });
});

describe('dwell_ms', () => {
  test.each(['yes', 'later', 'escape', 'gone'])('%s: a whole number of ms from 0 to a day is logged', async (step) => {
    for (const ms of [0, 4200, DAY_MS]) {
      logEvent.mockClear();
      expect((await call({ step, lang: 'en', src: 'result', dwell_ms: ms })).status).toBe(200);
      expect(logged()).toEqual([{ step, lang: 'en', src: 'result', dwell_ms: ms }]);
    }
  });
  test.each([
    ['a string', '4200'], ['negative', -1], ['a fraction', 4200.5], ['over a day', DAY_MS + 1], ['null', null], ['an object', { ms: 1 }], ['true', true],
  ])('%s is dropped; the step is logged exactly as before', async (_n, ms) => {
    expect((await call({ step: 'yes', lang: 'en', src: 'result', dwell_ms: ms })).status).toBe(200);
    expect(logged()).toEqual([{ step: 'yes', lang: 'en', src: 'result' }]);
  });
  test.each(['shown', 'granted', 'denied', 'subscribed', 'copy', 'stop'])('on %s (not the first answer) it is dropped', async (step) => {
    expect((await call({ step, lang: 'en', src: 'result', dwell_ms: 4200 })).status).toBe(200);
    expect(logged()).toEqual([{ step, lang: 'en', src: 'result' }]);
  });
  test('an unknown step is still refused', async () => {
    expect((await call({ step: 'left', lang: 'en', dwell_ms: 1 })).status).toBe(400);
    expect(logged()).toEqual([]);
  });
});
