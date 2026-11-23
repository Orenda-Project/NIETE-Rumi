'use strict';
/**
 * The reminder's own events carry the page session id (`ps`, wq-tel.js's 12-character id) when the page or its worker
 * sent one, so a funnel read can drop QA walks by joining page_start.ua: remind_step, push_subscribed, push_opened and
 * push_delivered. A well-formed ps → the logged props hold it; none, or any other shape → the props are exactly what
 * they were before. Through the internal router (portal → bot) with a fake database. Invented values.
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
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/ps-test', keys: { p256dh: 'p', auth: 'a' } };
const PS = 'k3j9x0a1b2c4';
// none, empty, upper case, short, long, a number, a space, markup: never logged
const NOT_PS = [undefined, '', 'K3J9X0A1B2C4', 'k3j9x0', 'k3j9x0a1b2c45', 123456789012, 'k3j9 0a1b2c4', '<b>k3j9</b>'];
const UA = 'Mozilla/5.0 (Linux; Android 14) Chrome/130';
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';

let fake;
let srv;
let base;
const call = (p, body, headers = {}) => fetch(`${base}${MOUNT_PATH}${p}`, {
  method: 'POST', headers: { 'x-api-key': process.env.INTERNAL_API_KEY, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const logged = (name) => logEvent.mock.calls.filter(([e]) => e === name).map(([, d]) => d);

beforeAll(async () => {
  Object.assign(process.env, ENV);
  const app = express();
  expect(mountPushRemind(app)).toBe(true);
  srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(() => srv && srv.close());
beforeEach(() => {
  fake = makeFake({ app_settings: [{ key: 'web_quiz_push_remind', value: true }], web_quiz_push_subscriptions: [] });
  supabase.from = (t) => fake.from(t);
  Push.__reset();
  logEvent.mockClear();
});

describe('remind_step', () => {
  const STEP = { step: 'granted', lang: 'en', src: 'result' };
  test('with ps: the props hold it, beside today\'s', async () => {
    expect((await call('/e', { ...STEP, ps: PS })).status).toBe(200);
    expect(logged('web_quiz.remind_step')).toEqual([{ ...STEP, ps: PS }]);
  });
  test.each(NOT_PS.map((v) => [JSON.stringify(v), v]))('ps %s: exactly today\'s props', async (_n, v) => {
    await call('/e', { ...STEP, ps: v });
    expect(logged('web_quiz.remind_step')).toEqual([STEP]);
  });
});

describe('push_subscribed', () => {
  const subscribe = (ps) => call('/subscribe', { sub: SUB, code: 'ABC123', lang: 'en', chips: 1, ...(ps === undefined ? {} : { ps }) }, { 'x-wq-device': DEVICE, 'user-agent': UA });
  test('with ps: today\'s props plus ps', async () => {
    expect((await subscribe(PS)).status).toBe(200);
    expect(logged('web_quiz.push_subscribed')).toEqual([{ kind: 'quiz_reminder', via: 'family_phone', ua_class: 'chrome_android', chips_n: 1, ps: PS }]);
  });
  test.each(NOT_PS.map((v) => [JSON.stringify(v), v]))('ps %s: exactly today\'s props', async (_n, v) => {
    await subscribe(v);
    expect(logged('web_quiz.push_subscribed')).toEqual([{ kind: 'quiz_reminder', via: 'family_phone', ua_class: 'chrome_android', chips_n: 1 }]);
  });
  test('the row stores no ps (no column; the id lives only in the log line)', async () => {
    await subscribe(PS);
    expect(fake.db.web_quiz_push_subscriptions).toHaveLength(1);
    expect(JSON.stringify(fake.db.web_quiz_push_subscriptions[0])).not.toContain(PS);
  });
});

describe('push_opened (the worker sends the ps the page kept at subscribe time)', () => {
  beforeEach(async () => {
    await call('/subscribe', { sub: SUB, code: 'ABC123', lang: 'en', chips: 1 }, { 'x-wq-device': DEVICE, 'user-agent': UA });
    logEvent.mockClear();
  });
  test('with ps: {kind, ps}', async () => {
    expect(await (await call('/opened', { endpoint: SUB.endpoint, ps: PS })).json()).toEqual({ ok: 1 });
    expect(logged('web_quiz.push_opened')).toEqual([{ kind: 'quiz_reminder', ps: PS }]);
  });
  test.each(NOT_PS.map((v) => [JSON.stringify(v), v]))('ps %s: exactly {kind}', async (_n, v) => {
    await call('/opened', { endpoint: SUB.endpoint, ps: v });
    expect(logged('web_quiz.push_opened')).toEqual([{ kind: 'quiz_reminder' }]);
  });
});

describe('push_delivered', () => {
  test('with ps: today\'s props plus ps', async () => {
    expect(await (await call('/delivered', { tag: 'jugnu-remind', shown: true, ps: PS })).json()).toEqual({ ok: 1 });
    expect(logged('web_quiz.push_delivered')).toEqual([{ kind: 'quiz_reminder', reason: 'quiz_reminder', shown: true, ps: PS }]);
  });
  test('a failed show with ps: {…, shown: false, err, ps}', async () => {
    await call('/delivered', { tag: 'jugnu-remind', shown: false, err: 'TypeError', ps: PS });
    expect(logged('web_quiz.push_delivered')).toEqual([{ kind: 'quiz_reminder', reason: 'quiz_reminder', shown: false, err: 'TypeError', ps: PS }]);
  });
  test.each(NOT_PS.map((v) => [JSON.stringify(v), v]))('ps %s: exactly today\'s props', async (_n, v) => {
    await call('/delivered', { tag: 'jugnu-remind', shown: true, ps: v });
    expect(logged('web_quiz.push_delivered')).toEqual([{ kind: 'quiz_reminder', reason: 'quiz_reminder', shown: true }]);
  });
});
